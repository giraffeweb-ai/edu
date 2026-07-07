import asyncio
import importlib
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from fastapi import BackgroundTasks
from starlette.datastructures import UploadFile


class BackendSmokeTest(unittest.TestCase):
    def test_cumulative_analysis_preserves_metrics_and_uses_newest_trend(self) -> None:
        backend = importlib.import_module("backend.app")
        base = {
            "school": {"code": "TEST001", "name": "測試分校", "region": "北區"},
            "summary": {
                "totalFiles": 1,
                "parsedFiles": 1,
                "statusCounts": {"已解析": 1},
                "categoryCounts": {"校務評鑑": 1},
            },
            "metrics": {
                "students": 138,
                "schoolEvaluationScore": 54.86,
                "studentTrend": [],
            },
            "evidence": [],
            "pendingItems": [],
            "files": [],
            "managementRequirements": [],
        }
        supplement = {
            **base,
            "summary": {
                "totalFiles": 1,
                "parsedFiles": 1,
                "statusCounts": {"已解析": 1},
                "categoryCounts": {"經營數據": 1},
            },
            "metrics": {
                "students": None,
                "schoolEvaluationScore": None,
                "studentTrend": [{"year": 2025, "value": 138}, {"year": 2026, "value": 140}],
            },
        }

        merged = backend.merge_school_analyses([base, supplement])

        self.assertEqual(merged["metrics"]["students"], 140)
        self.assertEqual(merged["metrics"]["schoolEvaluationScore"], 54.86)
        self.assertEqual(merged["uploadCount"], 2)

    def test_create_upload_classify_and_assign(self) -> None:
        backend = importlib.import_module("backend.app")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backend.ROOT = root
            backend.SCHOOLS_DIR = root / "分校資料"
            backend.INDEX_DIR = root / "00_資料索引"
            backend.DB_PATH = backend.INDEX_DIR / "教務輔導.db"
            backend.SCHOOL_CSV = backend.INDEX_DIR / "分校清冊.csv"
            backend.initialize_database()

            response = asyncio.run(
                backend.receive_upload(
                    background_tasks=BackgroundTasks(),
                    files=[UploadFile(filename="2026板橋溪崑輔導紀錄.txt", file=BytesIO(b"local backend smoke test"))],
                    mode="new",
                    school_code="TEST001",
                    school_name="板橋溪崑測試分校",
                    region="北區",
                    year="2026",
                    created_by="tracy",
                    category="由系統自動判讀",
                )
            )
            payload = json.loads(response.body)
            self.assertTrue(payload["ok"])
            stored = list((backend.SCHOOLS_DIR / "北區" / "TEST001_板橋溪崑測試分校" / "04_輔導紀錄" / "2026").glob("*.txt"))
            self.assertEqual(len(stored), 1)

            backend.run_analysis_job("TEST001", payload["uploadId"])
            backend.assign_school("TEST001", backend.AssignmentRequest(counselor_id="tracy"))
            with backend.db_connect() as db:
                school = db.execute("SELECT assigned_to FROM schools WHERE code='TEST001'").fetchone()
                upload = db.execute("SELECT status FROM uploads WHERE school_code='TEST001'").fetchone()
            self.assertEqual(school["assigned_to"], "tracy")
            self.assertEqual(upload["status"], "分析完成")


if __name__ == "__main__":
    unittest.main()
