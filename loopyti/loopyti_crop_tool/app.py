    """
    투명 배경 자동 크롭 (배포용 안정 버전)
    thresholds: 여러 임계값 후보
    min_ratio: bbox가 원본 대비 너무 작으면 무시
    """
    img = img.convert("RGBA")
    data = np.array(img)
    alpha = data[:, :, 3]
    h, w = alpha.shape
    total_area = h * w

    best_bbox = None
    best_area = None

    for t in thresholds:
        coords = np.argwhere(alpha > t)
        if coords.size == 0:
            continue

        ymin, xmin = coords.min(axis=0)
        ymax, xmax = coords.max(axis=0) + 1
        area = (xmax - xmin) * (ymax - ymin)

        if area / total_area < min_ratio:
            continue

        if best_area is None or area < best_area:
            best_area = area
            best_bbox = (xmin, ymin, xmax, ymax)
            logging.debug(f"[crop] threshold={t}, bbox={best_bbox}, area={area}")

    if best_bbox:
        logging.info(f"[crop] 최종 bbox={best_bbox}, area={best_area}")
        img = img.crop(best_bbox)
    else:
        logging.warning("[crop] 전경 없음 또는 조건 불충족 → 원본 반환")
    return img


    zip_buffer = io.BytesIO()

    )
