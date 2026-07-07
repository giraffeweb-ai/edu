from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import sqlite3
import unicodedata
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.analyzer import build_analysis


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "網站原型"
SCHOOLS_DIR = ROOT / "分校資料"
INDEX_DIR = ROOT / "00_資料索引"
DB_PATH = INDEX_DIR / "教務輔導.db"
SCHOOL_CSV = INDEX_DIR / "分校清冊.csv"
OCR_SCRIPT = ROOT / "backend" / "ocr.swift"
MAX_BATCH_BYTES = 500 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
ALLOWED_REGIONS = {"北區", "桃區", "中區", "南區", "高區"}
SCHOOL_CODE_RE = re.compile(r"^[A-Z0-9_-]{2,20}$")

FIXED_FOLDERS = (
    "00_分校基本資料",
    "01_經營數據",
    "02_續約指標數據",
    "03_校務評鑑",
    "04_輔導紀錄",
    "05_續約管理",
    "90_分析產出",
    "99_待分類",
)

CATEGORY_FOLDERS = {
    "分校基本資料": "00_分校基本資料",
    "經營數據": "01_經營數據",
    "續約指標數據": "02_續約指標數據",
    "校務評鑑": "03_校務評鑑",
    "輔導紀錄": "04_輔導紀錄",
    "續約管理": "05_續約管理",
}


class AssignmentRequest(BaseModel):
    counselor_id: str


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def db_connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    SCHOOLS_DIR.mkdir(parents=True, exist_ok=True)
    with db_connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS schools (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                region TEXT NOT NULL,
                folder_path TEXT NOT NULL,
                assigned_to TEXT,
                created_by TEXT,
                status TEXT NOT NULL DEFAULT 'pending_assignment',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS uploads (
                id TEXT PRIMARY KEY,
                school_code TEXT NOT NULL REFERENCES schools(code),
                year TEXT NOT NULL,
                category TEXT NOT NULL,
                file_count INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                created_by TEXT NOT NULL,
                status TEXT NOT NULL,
                analysis_status TEXT NOT NULL,
                analysis_path TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS upload_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upload_id TEXT NOT NULL REFERENCES uploads(id),
                original_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                predicted_category TEXT NOT NULL,
                file_year TEXT NOT NULL DEFAULT '待確認年度',
                size_bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL
            );
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(upload_files)").fetchall()}
        if "file_year" not in columns:
            db.execute("ALTER TABLE upload_files ADD COLUMN file_year TEXT NOT NULL DEFAULT '待確認年度'")
        upload_columns = {row["name"] for row in db.execute("PRAGMA table_info(uploads)").fetchall()}
        if "analysis_path" not in upload_columns:
            db.execute("ALTER TABLE uploads ADD COLUMN analysis_path TEXT")
    import_existing_schools()


def import_existing_schools() -> None:
    rows: list[dict[str, str]] = []
    if SCHOOL_CSV.exists():
        with SCHOOL_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            rows.extend(csv.DictReader(handle))

    for region_dir in SCHOOLS_DIR.iterdir():
        if not region_dir.is_dir() or region_dir.name not in ALLOWED_REGIONS:
            continue
        for school_dir in region_dir.iterdir():
            if not school_dir.is_dir() or "_" not in school_dir.name:
                continue
            code, name = school_dir.name.split("_", 1)
            if not SCHOOL_CODE_RE.fullmatch(code.upper()):
                continue
            if not any(row.get("分校代碼", "").upper() == code.upper() for row in rows):
                rows.append(
                    {
                        "分校代碼": code.upper(),
                        "分校名稱": name,
                        "所屬區域": region_dir.name,
                        "資料夾路徑": str(school_dir.relative_to(ROOT)),
                    }
                )

    with db_connect() as db:
        for row in rows:
            code = (row.get("分校代碼") or "").strip().upper()
            name = (row.get("分校名稱") or "").strip()
            region = (row.get("所屬區域") or "").strip()
            if not code or not name or region not in ALLOWED_REGIONS:
                continue
            folder_path = row.get("資料夾路徑") or f"分校資料/{region}/{code}_{name}"
            assigned_to = "tracy" if code == "GN26058" else None
            status = "assigned" if assigned_to else "pending_assignment"
            timestamp = now_iso()
            db.execute(
                """
                INSERT INTO schools
                    (code, name, region, folder_path, assigned_to, created_by, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                    name=excluded.name,
                    region=excluded.region,
                    folder_path=excluded.folder_path
                """,
                (code, name, region, folder_path, assigned_to, "system", status, timestamp, timestamp),
            )


def sanitize_school_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    normalized = re.sub(r"[\x00-\x1f/\\:]+", "_", normalized)
    normalized = normalized.strip(" ._")
    if not normalized or len(normalized) > 80:
        raise HTTPException(400, "分校名稱格式不正確")
    return normalized


def sanitize_filename(value: str) -> str:
    name = Path(unicodedata.normalize("NFKC", value)).name
    name = re.sub(r"[\x00-\x1f/\\:]+", "_", name).strip(" .")
    if not name:
        name = "未命名檔案"
    return name[:180]


def unique_path(folder: Path, filename: str) -> Path:
    candidate = folder / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    counter = 2
    while True:
        candidate = folder / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def ensure_school_folders(region: str, code: str, name: str) -> Path:
    folder = SCHOOLS_DIR / region / f"{code}_{name}"
    for child in FIXED_FOLDERS:
        (folder / child).mkdir(parents=True, exist_ok=True)
    return folder


def predict_category(filename: str, requested: str) -> str:
    if requested in CATEGORY_FOLDERS:
        return requested
    lowered = filename.casefold()
    rules = (
        ("分校基本資料", ("基本資料", "分校資料")),
        ("校務評鑑", ("校評", "評鑑")),
        ("續約管理", ("續約", "訪談表", "管理檢核")),
        ("續約指標數據", ("gnept", "教材", "器材", "研討")),
        ("輔導紀錄", ("輔導", "訪校", "錄音", "親訪")),
        ("經營數據", ("學生人數", "人數", "目標表", "季度目標", "營運")),
    )
    for category, keywords in rules:
        if any(keyword in lowered for keyword in keywords):
            return category
    return "待分類"


def predict_file_year(filename: str, selected_year: str) -> str:
    lowered = filename.casefold()
    years = sorted(set(re.findall(r"20\d{2}", lowered)))
    if len(years) > 1 or any(keyword in lowered for keyword in ("跨年度", "近三年", "近3年")):
        return "跨年度"
    if len(years) == 1:
        return years[0]
    return selected_year


def write_school_csv() -> None:
    existing_details: dict[str, dict[str, str]] = {}
    if SCHOOL_CSV.exists():
        with SCHOOL_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                existing_details[row.get("分校代碼", "")] = row
    fields = ("分校代碼", "分校名稱", "所屬區域", "負責人", "營運狀態", "合約到期日", "資料基準日", "資料夾路徑")
    with db_connect() as db:
        schools = db.execute("SELECT * FROM schools ORDER BY region, code").fetchall()
    temp_path = SCHOOL_CSV.with_suffix(".csv.tmp")
    with temp_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for school in schools:
            old = existing_details.get(school["code"], {})
            writer.writerow(
                {
                    "分校代碼": school["code"],
                    "分校名稱": school["name"],
                    "所屬區域": school["region"],
                    "負責人": old.get("負責人", ""),
                    "營運狀態": old.get("營運狀態", "待建檔"),
                    "合約到期日": old.get("合約到期日", ""),
                    "資料基準日": old.get("資料基準日", datetime.now().date().isoformat()),
                    "資料夾路徑": school["folder_path"],
                }
            )
    temp_path.replace(SCHOOL_CSV)


def school_to_dict(row: sqlite3.Row) -> dict[str, object]:
    return {
        "code": row["code"],
        "name": row["name"],
        "region": row["region"],
        "assignedTo": row["assigned_to"],
        "createdBy": row["created_by"],
        "status": row["status"],
        "folderPath": row["folder_path"],
    }


def upload_to_dict(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "schoolCode": row["school_code"],
        "schoolName": row["school_name"],
        "region": row["region"],
        "year": row["year"],
        "fileCount": row["file_count"],
        "totalBytes": row["total_bytes"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"][:10].replace("-", "."),
        "status": row["status"],
        "analysisStatus": row["analysis_status"],
        "analysisPath": row["analysis_path"],
    }


def run_analysis_job(school_code: str, upload_id: str) -> None:
    with db_connect() as db:
        school_row = db.execute("SELECT * FROM schools WHERE code = ?", (school_code,)).fetchone()
        upload_row = db.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        file_rows = db.execute(
            """
            SELECT original_name, stored_path, predicted_category, file_year
            FROM upload_files WHERE upload_id = ? ORDER BY id
            """,
            (upload_id,),
        ).fetchall()
        if not school_row or not upload_row:
            return
        db.execute(
            "UPDATE uploads SET status = '分析中', analysis_status = '內容解析中' WHERE id = ?",
            (upload_id,),
        )

    school = {
        "code": school_row["code"],
        "name": school_row["name"],
        "region": school_row["region"],
    }
    try:
        analysis = build_analysis(
            school=school,
            upload_id=upload_id,
            file_records=[dict(row) for row in file_rows],
            root=ROOT,
            ocr_script=OCR_SCRIPT,
        )
        output_dir = ROOT / school_row["folder_path"] / "90_分析產出" / "內容解析"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{upload_id}.json"
        output_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as error:
        with db_connect() as db:
            db.execute(
                "UPDATE uploads SET status = '分析失敗', analysis_status = ? WHERE id = ?",
                (f"分析失敗：{str(error)[:200]}", upload_id),
            )
        return

    parsed = int(analysis["summary"]["parsedFiles"])
    total = int(analysis["summary"]["totalFiles"])
    if total and parsed == total:
        analysis_status = "分析完成"
        status = "分析完成"
    elif parsed:
        analysis_status = "部分完成"
        status = "部分完成"
    else:
        analysis_status = "待補資料"
        status = "待補資料"
    if not school_row["assigned_to"]:
        status = f"{status} · 待主管指派"
    with db_connect() as db:
        db.execute(
            "UPDATE uploads SET status = ?, analysis_status = ?, analysis_path = ? WHERE id = ?",
            (status, analysis_status, str(output_path.relative_to(ROOT)), upload_id),
        )


def analyze_pending_uploads() -> None:
    with db_connect() as db:
        pending = db.execute(
            """
            SELECT id, school_code FROM uploads
            WHERE analysis_status IN ('尚未開始', '等待內容解析', '等待後端解析', '內容解析中')
            ORDER BY created_at
            """
        ).fetchall()
    for row in pending:
        run_analysis_job(row["school_code"], row["id"])


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    analyze_pending_uploads()
    yield


app = FastAPI(title="教務輔導決策平台本機後端", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, object]:
    usage = shutil.disk_usage(ROOT)
    return {
        "ok": True,
        "freeBytes": usage.free,
        "maxBatchBytes": MAX_BATCH_BYTES,
        "database": str(DB_PATH.relative_to(ROOT)),
    }


@app.get("/api/state")
def state() -> dict[str, object]:
    with db_connect() as db:
        schools = db.execute("SELECT * FROM schools ORDER BY region, code").fetchall()
        uploads = db.execute(
            """
            SELECT uploads.*, schools.name AS school_name, schools.region AS region
            FROM uploads JOIN schools ON schools.code = uploads.school_code
            ORDER BY uploads.created_at DESC LIMIT 50
            """
        ).fetchall()
    return {
        "schools": [school_to_dict(row) for row in schools],
        "uploads": [upload_to_dict(row) for row in uploads],
    }


@app.post("/api/uploads")
async def receive_upload(
    background_tasks: BackgroundTasks,
    files: Annotated[list[UploadFile], File()],
    mode: Annotated[str, Form()],
    school_code: Annotated[str, Form()],
    school_name: Annotated[str, Form()],
    region: Annotated[str, Form()],
    year: Annotated[str, Form()],
    created_by: Annotated[str, Form()],
    category: Annotated[str, Form()] = "由系統自動判讀",
) -> JSONResponse:
    code = school_code.strip().upper()
    if not SCHOOL_CODE_RE.fullmatch(code):
        raise HTTPException(400, "分校代碼僅能使用英文字母、數字、底線或連字號")
    if region not in ALLOWED_REGIONS:
        raise HTTPException(400, "所屬區域不正確")
    if not files:
        raise HTTPException(400, "請至少選擇一個檔案")
    safe_year = year if re.fullmatch(r"(20\d{2}|跨年度)", year) else "待確認年度"
    timestamp = now_iso()

    with db_connect() as db:
        school = db.execute("SELECT * FROM schools WHERE code = ?", (code,)).fetchone()
        if mode == "new":
            if school:
                raise HTTPException(409, f"分校代碼 {code} 已存在")
            name = sanitize_school_name(school_name)
            school_folder = ensure_school_folders(region, code, name)
            relative_folder = str(school_folder.relative_to(ROOT))
            db.execute(
                """
                INSERT INTO schools
                    (code, name, region, folder_path, assigned_to, created_by, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, NULL, ?, 'pending_assignment', ?, ?)
                """,
                (code, name, region, relative_folder, created_by, timestamp, timestamp),
            )
            school = db.execute("SELECT * FROM schools WHERE code = ?", (code,)).fetchone()
        elif not school:
            raise HTTPException(404, "找不到指定分校")
        elif school["region"] != region:
            raise HTTPException(400, "分校與區域不一致")

    school_folder = ROOT / school["folder_path"]
    ensure_school_folders(school["region"], school["code"], school["name"])
    upload_id = uuid.uuid4().hex[:16]
    stored_files: list[dict[str, object]] = []
    created_paths: list[Path] = []
    total_bytes = 0

    try:
        for incoming in files:
            original_name = sanitize_filename(incoming.filename or "")
            predicted = predict_category(original_name, category)
            file_year = predict_file_year(original_name, safe_year)
            target_root = school_folder / (CATEGORY_FOLDERS.get(predicted) or "99_待分類")
            target_folder = target_root / file_year
            target_folder.mkdir(parents=True, exist_ok=True)
            target_path = unique_path(target_folder, original_name)
            part_path = target_path.with_name(f".{target_path.name}.{upload_id}.part")
            digest = hashlib.sha256()
            file_bytes = 0
            with part_path.open("wb") as output:
                while chunk := await incoming.read(CHUNK_SIZE):
                    total_bytes += len(chunk)
                    file_bytes += len(chunk)
                    if total_bytes > MAX_BATCH_BYTES:
                        raise HTTPException(413, "單批上傳不可超過 500MB")
                    output.write(chunk)
                    digest.update(chunk)
            part_path.replace(target_path)
            created_paths.append(target_path)
            stored_files.append(
                {
                    "originalName": original_name,
                    "storedPath": str(target_path.relative_to(ROOT)),
                    "predictedCategory": predicted,
                    "fileYear": file_year,
                    "sizeBytes": file_bytes,
                    "sha256": digest.hexdigest(),
                }
            )
    except Exception:
        for path in created_paths:
            path.unlink(missing_ok=True)
        for part in school_folder.rglob(f".*.{upload_id}.part"):
            part.unlink(missing_ok=True)
        raise
    finally:
        for incoming in files:
            await incoming.close()

    status = "分析中 · 待主管指派" if not school["assigned_to"] else "已入庫 · 分析中"
    analysis_status = "內容解析中"
    manifest = {
        "uploadId": upload_id,
        "schoolCode": code,
        "schoolName": school["name"],
        "region": school["region"],
        "year": safe_year,
        "createdBy": created_by,
        "createdAt": timestamp,
        "status": status,
        "analysisStatus": analysis_status,
        "totalBytes": total_bytes,
        "files": stored_files,
    }
    manifest_dir = school_folder / "90_分析產出" / "上傳批次"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_dir / f"{upload_id}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    with db_connect() as db:
        db.execute(
            """
            INSERT INTO uploads
                (id, school_code, year, category, file_count, total_bytes, created_by, status, analysis_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (upload_id, code, safe_year, category, len(stored_files), total_bytes, created_by, status, analysis_status, timestamp),
        )
        db.executemany(
            """
            INSERT INTO upload_files
                (upload_id, original_name, stored_path, predicted_category, file_year, size_bytes, sha256)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    upload_id,
                    item["originalName"],
                    item["storedPath"],
                    item["predictedCategory"],
                    item["fileYear"],
                    item["sizeBytes"],
                    item["sha256"],
                )
                for item in stored_files
            ],
        )
    write_school_csv()
    background_tasks.add_task(run_analysis_job, code, upload_id)
    return JSONResponse(
        status_code=201,
        content={
            "ok": True,
            "uploadId": upload_id,
            "school": school_to_dict(school),
            "status": status,
            "fileCount": len(stored_files),
            "manifestPath": str(manifest_path.relative_to(ROOT)),
        },
    )


@app.post("/api/schools/{school_code}/assign")
def assign_school(school_code: str, payload: AssignmentRequest) -> dict[str, object]:
    code = school_code.strip().upper()
    counselor_id = payload.counselor_id.strip().lower()
    if not counselor_id:
        raise HTTPException(400, "請指定輔導員")
    timestamp = now_iso()
    with db_connect() as db:
        school = db.execute("SELECT * FROM schools WHERE code = ?", (code,)).fetchone()
        if not school:
            raise HTTPException(404, "找不到指定分校")
        db.execute(
            "UPDATE schools SET assigned_to = ?, status = 'assigned', updated_at = ? WHERE code = ?",
            (counselor_id, timestamp, code),
        )
        db.execute(
            """
            UPDATE uploads SET status =
                CASE analysis_status
                    WHEN '分析完成' THEN '分析完成'
                    WHEN '部分完成' THEN '部分完成'
                    WHEN '待補資料' THEN '待補資料'
                    ELSE '已指派 · 分析中'
                END
            WHERE school_code = ?
            """,
            (code,),
        )
        updated = db.execute("SELECT * FROM schools WHERE code = ?", (code,)).fetchone()
    return {"ok": True, "school": school_to_dict(updated)}


@app.get("/api/schools/{school_code}/analysis")
def school_analysis(school_code: str) -> dict[str, object]:
    code = school_code.strip().upper()
    with db_connect() as db:
        uploads = db.execute(
            """
            SELECT id, analysis_path, created_at FROM uploads
            WHERE school_code = ? AND analysis_path IS NOT NULL
            ORDER BY created_at, id
            """,
            (code,),
        ).fetchall()
    if not uploads:
        raise HTTPException(404, "尚無分析結果")

    analyses: list[dict[str, object]] = []
    for upload in uploads:
        path = ROOT / upload["analysis_path"]
        if not path.exists():
            continue
        analysis = json.loads(path.read_text(encoding="utf-8"))
        analysis["_createdAt"] = upload["created_at"]
        analyses.append(analysis)
    if not analyses:
        raise HTTPException(404, "分析結果檔案不存在")
    return merge_school_analyses(analyses)


def merge_school_analyses(analyses: list[dict[str, object]]) -> dict[str, object]:
    """Merge upload-level analyses without allowing a newer empty field to erase known data."""
    metric_keys = (
        "students",
        "averageStudents",
        "schoolEvaluationScore",
        "contractEnd",
        "classCount",
        "teacherCards",
        "trainingHours",
        "marketShare",
        "mainMaterialRate",
        "supplementMaterialRate",
        "gneptTotal",
    )
    merged_metrics: dict[str, object] = {key: None for key in metric_keys}
    merged_metrics["evaluationDimensions"] = []
    trend_by_year: dict[int, dict[str, object]] = {}
    status_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    total_files = 0
    parsed_files = 0
    evidence: list[dict[str, object]] = []
    pending_by_name: dict[str, dict[str, object]] = {}
    files: list[dict[str, object]] = []
    requirements: list[str] = []

    for analysis in analyses:
        summary = analysis.get("summary") or {}
        total_files += int(summary.get("totalFiles") or 0)
        parsed_files += int(summary.get("parsedFiles") or 0)
        for name, count in (summary.get("statusCounts") or {}).items():
            status_counts[name] = status_counts.get(name, 0) + int(count)
        for name, count in (summary.get("categoryCounts") or {}).items():
            category_counts[name] = category_counts.get(name, 0) + int(count)

        metrics = analysis.get("metrics") or {}
        for key in metric_keys:
            value = metrics.get(key)
            if value is not None and value != "":
                merged_metrics[key] = value
        dimensions = metrics.get("evaluationDimensions") or []
        if dimensions:
            merged_metrics["evaluationDimensions"] = dimensions
        points = metrics.get("studentTrend") or []
        for point in points:
            try:
                trend_by_year[int(point["year"])] = {
                    "year": int(point["year"]),
                    "value": point["value"],
                }
            except (KeyError, TypeError, ValueError):
                continue
        if metrics.get("students") is None and points:
            newest_point = max(points, key=lambda point: int(point.get("year") or 0))
            if newest_point.get("value") is not None:
                merged_metrics["students"] = newest_point["value"]

        for item in analysis.get("evidence") or []:
            if item not in evidence:
                evidence.append(item)
        for item in analysis.get("pendingItems") or []:
            pending_by_name[str(item.get("filename") or len(pending_by_name))] = item
        for item in analysis.get("files") or []:
            files.append(item)
            if item.get("status") == "已解析":
                pending_by_name.pop(str(item.get("filename") or ""), None)
        for requirement in analysis.get("managementRequirements") or []:
            if requirement not in requirements:
                requirements.append(requirement)

    trends = [trend_by_year[year] for year in sorted(trend_by_year)]
    merged_metrics["studentTrend"] = trends
    completion = round(parsed_files / total_files * 100) if total_files else 0
    categories = "、".join(category_counts) or "無"
    pending = list(pending_by_name.values())
    latest = analyses[-1]

    return {
        "schemaVersion": 2,
        "analysisScope": "school-cumulative",
        "uploadId": latest.get("uploadId"),
        "uploadCount": len(analyses),
        "school": latest.get("school") or {},
        "generatedAt": latest.get("generatedAt"),
        "summary": {
            "totalFiles": total_files,
            "parsedFiles": parsed_files,
            "completionPercent": completion,
            "statusCounts": status_counts,
            "categoryCounts": category_counts,
        },
        "findings": [
            f"已彙整此分校 {len(analyses)} 個上傳批次，共 {total_files} 個項目。",
            f"累積成功解析 {parsed_files} 個項目，內容解析完成度 {completion}%。",
            f"已取得的資料類別：{categories}。",
            f"目前仍有 {len(pending)} 個項目需要補檔、OCR、轉錄或人工處理。",
        ],
        "managementRequirements": requirements,
        "metrics": merged_metrics,
        "evidence": evidence,
        "pendingItems": pending,
        "files": files,
    }


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
