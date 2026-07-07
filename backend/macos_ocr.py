from __future__ import annotations

from pathlib import Path


def recognize_image(path: Path) -> str:
    from Foundation import NSData
    from Vision import VNImageRequestHandler, VNRecognizeTextRequest, VNRequestTextRecognitionLevelAccurate

    data = NSData.dataWithContentsOfFile_(str(path))
    if data is None:
        raise RuntimeError("無法開啟圖片")

    request = VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(VNRequestTextRecognitionLevelAccurate)
    request.setRecognitionLanguages_(["zh-Hant", "en-US"])
    request.setUsesLanguageCorrection_(True)
    handler = VNImageRequestHandler.alloc().initWithData_options_(data, {})
    success, error = handler.performRequests_error_([request], None)
    if not success:
        raise RuntimeError(str(error or "圖片OCR失敗"))

    lines: list[tuple[float, float, str]] = []
    for observation in request.results() or []:
        candidates = observation.topCandidates_(1)
        if not candidates:
            continue
        box = observation.boundingBox()
        lines.append((float(box.origin.y), float(box.origin.x), str(candidates[0].string())))
    lines.sort(key=lambda item: (-round(item[0], 2), item[1]))
    return "\n".join(line[2] for line in lines)
