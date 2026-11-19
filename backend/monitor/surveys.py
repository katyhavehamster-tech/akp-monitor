"""Порівняння результатів двох Google Форм (CSV та Excel .xlsx).

Принципи:
- електронні адреси не зберігаються: колонки з поштою і позначкою часу відкидаються під час імпорту;
- якщо в якійсь клітинці трапиться адреса пошти, її значення замінюється на «[приховано]»;
- результати показуються лише для груп, не менших за мінімальний розмір (SystemSettings.min_survey_group).
- автовизначення кодування при імпорті CSV (utf-8-sig, utf-8, cp1251, cp1252);
- підтримка прямих файлів Excel (.xlsx);
- нормалізація порожніх і неінформативних відповідей;
- згортання довгих списків відповідей («Інше / Своя відповідь»);
- маркування обов'язковості питань (*).
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from collections import Counter
from datetime import datetime

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
DROP_HEADERS = ("позначка часу", "timestamp", "електронн", "email", "e-mail", "пошт", "адреса ел")
MULTI_SEP = ";"

MAX_SURVEY_BYTES = 10 * 1024 * 1024
EMPTY_ANSWER_LABEL = "Відсутня відповідь / Не вказано"
DONT_KNOW_LABEL = "Не знаю / Важко відповісти"
NO_RISKS_LABEL = "Ризики відсутні / Не стикався"

ILLEGAL_CHARACTERS_RE = re.compile(r"[\000-\010]|[\013-\014]|[\016-\037]")


def _sanitize_cell(v):
    """Очищення клітинок для безпечного експорту в Excel (без падінь на спецсимволах і формула-ін'єкцій)."""
    if v is None:
        return ""
    if isinstance(v, str):
        cleaned = ILLEGAL_CHARACTERS_RE.sub("", v)
        stripped = cleaned.lstrip()
        formula_triggers = ("=", "+", "-", "@", "\t", "\r")
        if (cleaned.startswith(formula_triggers) or (stripped and stripped.startswith(formula_triggers))) and not re.match(r"^[-+]?\d+(\.\d+)?$", cleaned.strip()):
            return "'" + cleaned
        return cleaned
    return v


# Відмови від відповіді, відписки, сленг (а)
REFUSAL_TOKENS = {
    "не відповів", "не відповідав", "відмовляюсь надавати відповідь", "відмовляюся надавати відповідь",
    "відмовляюсь", "відмовляюся", "без коментарів", "без коментарів.", "гг", "четко", "чітко",
    "немає даних", "н/д", "n/a", "na", "none", "null", "прочерк", "без відповіді", "не вказано",
    "не зазначено"
}

# Варіації невпевненості (b)
DONT_KNOW_VARIANTS = {
    "не знаю", "незнаю", "навіть не знаю", "невідомо", "не відомо", "невідомі", "мені не відомо",
    "не можу відповісти", "не можу сказати", "не можу дати точної відповіді",
    "важко відповісти", "важко сказати", "важко визначити", "складно відповісти", "складно сказати",
    "складно", "трудно відповісти", "не маю уявлення", "не маю поняття", "не маю думки", "не маю відповіді",
    "без понятия", "без понятія", "хз", "не задумувався", "не замислювався", "не цікавлюсь", "не цікавилися",
    "не в курсі", "не в курсе", "не знаю навіть", "не володію інформацією"
}

# Заперечення наявності проблем / ризиків (c)
NO_RISKS_VARIANTS = {
    "ні", "нi", "нет", "нічо", "нічого", "ніяких", "ніякі", "ніякої", "нияких", "ниякі", "неякі",
    "ні які", "ні яких", "ні як", "жодних", "жодні", "жодного", "немає", "нема", "немае", "не мае",
    "їх немає", "їх нема", "їх не має", "німа", "нима", "нету", "не існує", "не існують", "неіснують",
    "не существует", "відсутні", "відустні", "відстуні", "відсутня", "відсутній", "відсутнє",
    "ризики відсутні", "ризиків немає", "ризиків не має", "немає ризиків", "корупційних ризиків немає",
    "корупційні ризики відсутні", "не стикався", "не стикалася", "не стикалися", "не помічав", "не помічала",
    "не помічено", "не зустрічав", "не зустрічала", "не зустрічається", "не спостерігається",
    "не було", "небуло", "все добре", "все чесно", "все прозоро", "все працює чітко", "немає зауважень"
}

NO_RISKS_PATTERNS = (
    "в університеті немає напрямків діяльності",
    "ризики корупції відсутні",
    "корупційні ризики відсутні",
    "корупційних ризиків немає",
    "ризиків немає",
    "ризики відсутні",
    "за жодним з напрямків діяльності",
    "за жодним напрямком",
)


def _decode_bytes(raw: bytes) -> str:
    """Автоматичний перебір кодувань для CSV (Cyrillic, UTF, Windows)."""
    for enc in ("utf-8-sig", "utf-8", "cp1251", "windows-1251", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _process_table(table: list[list[str]]) -> dict:
    if not table:
        raise ValueError("Порожній файл опитування")
    header = [h.strip() for h in table[0]]
    keep, dropped = [], []
    for i, h in enumerate(header):
        hl = h.lower()
        if any(k in hl for k in DROP_HEADERS):
            dropped.append(h)
        else:
            keep.append(i)
    answers = []
    for r in table[1:]:
        row = {}
        for i in keep:
            v = r[i].strip() if i < len(r) else ""
            row[header[i]] = "[приховано]" if EMAIL_RE.search(v) else v
        answers.append(row)
    return {"questions": [header[i] for i in keep], "answers": answers, "dropped": dropped}


def parse_csv(raw: bytes) -> dict:
    if len(raw) > MAX_SURVEY_BYTES:
        raise ValueError("Файл перевищує допустимий розмір (10 МБ)")
    text = _decode_bytes(raw)
    reader = csv.reader(io.StringIO(text))
    table = [r for r in reader if any(c.strip() for c in r)]
    return _process_table(table)


def parse_excel(raw: bytes) -> dict:
    if len(raw) > MAX_SURVEY_BYTES:
        raise ValueError("Файл перевищує допустимий розмір (10 МБ)")
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True)
    ws = wb.active
    table = []
    for row in ws.iter_rows(values_only=True):
        if not any(row):
            continue
        cleaned = [str(c).strip() if c is not None else "" for c in row]
        if any(cleaned):
            table.append(cleaned)
    return _process_table(table)


def parse_survey_file(raw: bytes, filename: str = "") -> dict:
    """Універсальний парсер опитувань: підтримує .xlsx та .csv."""
    if len(raw) > MAX_SURVEY_BYTES:
        raise ValueError("Файл перевищує допустимий розмір (10 МБ)")
    fn = filename.lower()
    if fn.endswith(".xlsx") or fn.endswith(".xlsm") or raw.startswith(b"PK\x03\x04"):
        try:
            return parse_excel(raw)
        except Exception:
            pass
    return parse_csv(raw)


def _normalize_text_for_compare(s: str) -> str:
    trans = str.maketrans("iacoxepABCEHIKMOPTX", "іасохерАВСЕНІКМОРТХ")
    cleaned = s.translate(trans).lower()
    cleaned = re.sub(r"^[^\wа-яіїєґ]+|[^\wа-яіїєґ]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def normalize_answer_value(v: str, is_binary_yes_no: bool = False) -> str:
    """Нормалізує порожні клітинки, символи, відмови від відповіді та типові шаблонні варіанти."""
    if v is None:
        return EMPTY_ANSWER_LABEL
    s = str(v).strip()
    if not s:
        return EMPTY_ANSWER_LABEL

    # а) Якщо рядок складається лише з розділових знаків, символів чи емодзі
    cleaned_symbols = re.sub(r"[\s\.\,\-\—\–\_\?\!\:\;\~\`\'\"\#\+\*\/\\\\\(\)\[\]\{\}\<\>\«\»\…\ʼ\‘\.\)\👍\❤️\🤝\✅]+", "", s)
    if not cleaned_symbols:
        return EMPTY_ANSWER_LABEL

    # Одиночна літера або тільки цифри (1-3 цифри без тексту)
    if len(cleaned_symbols) <= 1 or re.fullmatch(r"\d{1,3}", cleaned_symbols):
        return EMPTY_ANSWER_LABEL

    norm = _normalize_text_for_compare(s)
    if not norm:
        return EMPTY_ANSWER_LABEL

    # Якщо це бінарне питання (Так / Ні)
    if is_binary_yes_no:
        if norm in ("так", "да", "+"):
            return "Так"
        if norm in ("ні", "ні.", "нет", "-"):
            return "Ні"
        return s

    # а) Відмови від відповіді та відписки
    if norm in REFUSAL_TOKENS:
        return EMPTY_ANSWER_LABEL

    # b) «Не знаю / Важко відповісти»
    if norm in DONT_KNOW_VARIANTS or any(norm.startswith(p) for p in ("не знаю", "важко сказати", "важко відповісти", "складно відповісти")):
        return DONT_KNOW_LABEL

    # c) «Ризики відсутні / Не стикався»
    if norm in NO_RISKS_VARIANTS or any(p in norm for p in NO_RISKS_PATTERNS):
        return NO_RISKS_LABEL

    # Змістовна відповідь респондента
    return s


def _is_number(v: str) -> bool:
    try:
        float(v.replace(",", "."))
        return True
    except ValueError:
        return False


def question_kind(values: list[str]) -> str:
    vals = [v for v in values if v and v != EMPTY_ANSWER_LABEL]
    if not vals:
        return "empty"
    if all(_is_number(v) for v in vals):
        return "scale"
    if len(set(vals)) > max(10, 0.5 * len(vals)):
        return "text"
    return "choice"


def _dist(values: list[str]) -> tuple[dict, int]:
    vals = [v for v in values if v]
    c = Counter(vals)
    n = len(vals)
    if n == 0:
        return {}, 0
    return {k: {"n": c[k], "pct": round(100 * c[k] / n, 1)} for k in c}, n


def compare(a: dict, b: dict, min_group: int = 5, filter_q: str | None = None, filter_v: str | None = None) -> dict:
    """a, b: {"title", "questions", "answers"}. Повертає порівняння за спільними питаннями."""
    def filt(s):
        if filter_q and filter_v:
            return [r for r in s["answers"] if r.get(filter_q) == filter_v]
        return s["answers"]

    ra, rb = filt(a), filt(b)
    common = [q for q in a["questions"] if q in b["questions"]]
    only_a = [q for q in a["questions"] if q not in b["questions"]]
    only_b = [q for q in b["questions"] if q not in a["questions"]]
    hidden = len(ra) < min_group or len(rb) < min_group
    result = {
        "n_a": len(ra),
        "n_b": len(rb),
        "min_group": min_group,
        "hidden": hidden,
        "only_a": only_a,
        "only_b": only_b,
        "questions": [],
    }
    if hidden:
        return result

    for q in common:
        raw_va = [r.get(q, "") for r in ra]
        raw_vb = [r.get(q, "") for r in rb]
        all_raw = raw_va + raw_vb

        is_mandatory = ("*" in q)
        clean_title = q.replace("*", "").strip()

        # Визначаємо чи це класичне Так/Ні питання
        low_vals = {v.lower().strip() for v in all_raw if v}
        is_yes_no = ("так" in low_vals and "ні" in low_vals)

        va = [normalize_answer_value(v, is_yes_no) for v in raw_va]
        vb = [normalize_answer_value(v, is_yes_no) for v in raw_vb]

        kind = question_kind(va + vb)
        item = {
            "question": q,
            "clean_title": clean_title,
            "is_mandatory": is_mandatory,
            "kind": kind,
        }

        if kind == "scale":
            fa = [float(v.replace(",", ".")) for v in va if _is_number(v)]
            fb = [float(v.replace(",", ".")) for v in vb if _is_number(v)]
            ma = round(sum(fa) / len(fa), 2) if fa else None
            mb = round(sum(fb) / len(fb), 2) if fb else None
            da, _ = _dist([v for v in va if _is_number(v)])
            db, _ = _dist([v for v in vb if _is_number(v)])
            keys = sorted(set(da) | set(db), key=lambda x: float(x.replace(",", ".")))
            opts = [
                {
                    "option": k,
                    "a": da.get(k, {"pct": 0, "n": 0}),
                    "b": db.get(k, {"pct": 0, "n": 0}),
                    "delta_pp": round(db.get(k, {"pct": 0})["pct"] - da.get(k, {"pct": 0})["pct"], 1),
                }
                for k in keys
            ]
            item.update({
                "mean_a": ma,
                "mean_b": mb,
                "delta": round(mb - ma, 2) if ma is not None and mb is not None else None,
                "options": opts,
                "collapsed_options": opts,
                "has_many_options": False,
                "total_options_count": len(opts),
            })
        elif kind == "choice":
            def split_norm(vals):
                out = []
                for v in vals:
                    if MULTI_SEP in v:
                        out.extend([normalize_answer_value(x, is_yes_no) for x in v.split(MULTI_SEP)])
                    else:
                        out.append(normalize_answer_value(v, is_yes_no))
                return out

            s_va = split_norm(raw_va)
            s_vb = split_norm(raw_vb)
            da, _ = _dist(s_va)
            db, _ = _dist(s_vb)
            keys = sorted(set(da) | set(db), key=lambda k: -(da.get(k, {"n": 0})["n"] + db.get(k, {"n": 0})["n"]))
            all_opts = [
                {
                    "option": k,
                    "a": da.get(k, {"pct": 0, "n": 0}),
                    "b": db.get(k, {"pct": 0, "n": 0}),
                    "delta_pp": round(db.get(k, {"pct": 0})["pct"] - da.get(k, {"pct": 0})["pct"], 1),
                }
                for k in keys
            ]
            item["options"] = all_opts
            item["total_options_count"] = len(all_opts)

            # Якщо варіантів більше 6, згортаємо решту в узагальнений пункт
            if len(all_opts) > 6:
                item["has_many_options"] = True
                top_opts = all_opts[:5]
                rest = all_opts[5:]
                rest_a_n = sum(o["a"]["n"] for o in rest)
                rest_a_pct = round(sum(o["a"]["pct"] for o in rest), 1)
                rest_b_n = sum(o["b"]["n"] for o in rest)
                rest_b_pct = round(sum(o["b"]["pct"] for o in rest), 1)
                avg_pct = round((rest_a_pct + rest_b_pct) / 2, 1)
                other_summary = {
                    "option": f"Інше / Своя відповідь ({avg_pct}%)",
                    "a": {"n": rest_a_n, "pct": rest_a_pct},
                    "b": {"n": rest_b_n, "pct": rest_b_pct},
                    "delta_pp": round(rest_b_pct - rest_a_pct, 1),
                    "is_summary_other": True,
                    "sub_options_count": len(rest),
                }
                item["collapsed_options"] = top_opts + [other_summary]
            else:
                item["has_many_options"] = False
                item["collapsed_options"] = all_opts
        elif kind == "text":
            norm_ta = [normalize_answer_value(v) for v in raw_va if v]
            norm_tb = [normalize_answer_value(v) for v in raw_vb if v]
            item["answers_a"] = [t for t in norm_ta if t != EMPTY_ANSWER_LABEL]
            item["answers_b"] = [t for t in norm_tb if t != EMPTY_ANSWER_LABEL]
            item["uninformative_count_a"] = len(norm_ta) - len(item["answers_a"])
            item["uninformative_count_b"] = len(norm_tb) - len(item["answers_b"])

        result["questions"].append(item)
    return result


def group_options(a: dict, b: dict) -> list[dict]:
    """Питання, за якими можна фільтрувати (варіанти вибору, спільні для обох форм)."""
    out = []
    for q in a["questions"]:
        if q not in b["questions"]:
            continue
        vals = [r.get(q, "") for r in a["answers"] + b["answers"]]
        if question_kind(vals) == "choice":
            out.append({"question": q, "values": sorted({v for v in vals if v and MULTI_SEP not in v})})
    return out


def survey_xlsx(res: dict, user_profile=None) -> bytes:
    """Генерація зведеного Excel-звіту порівняння опитувань з водяним знаком ІзОД/ДСК."""
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.drawing.image import Image as OpenpyxlImage
    from . import docgen as D

    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "Загальні показники"
    ws2 = wb.create_sheet(title="Розподіл відповідей")

    navy_fill = PatternFill("solid", fgColor="0B2A5B")
    accent_fill = PatternFill("solid", fgColor="2563EB")
    soft_fill = PatternFill("solid", fgColor="F1F5F9")
    bold_font = Font(name="Calibri", size=11, bold=True)
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    # Watermark / classification line
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    u_code = getattr(user_profile, "code", "SYS")
    u_role = getattr(user_profile, "role", "ANAL")
    h = hashlib.sha256(f"{u_code}:{u_role}:{now_str}:survey".encode()).hexdigest()[:12]
    if u_role == "ANAL":
        wm_stamp = f"ANAL · {u_code} · {u_role} · {now_str} · ІзОД / ДСК · SHA-256: {h}"
    else:
        wm_stamp = f"ІзОД / ДСК · {u_code} · {u_role} · {now_str} · SHA-256: {h}"

    # Generate watermark image via Pillow
    wm_png_bytes = None
    try:
        wm_png_bytes = D.generate_watermark_png(wm_stamp, width=1300, height=900)
    except Exception:
        pass

    for ws in (ws1, ws2):
        ws.oddHeader.right.text = f"{wm_stamp} · ДСК"
        ws.oddFooter.right.text = f"Вивантажено: {wm_stamp}"
        ws.oddFooter.left.text = "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ · ІзОД"
        if wm_png_bytes:
            try:
                ws.add_image(OpenpyxlImage(io.BytesIO(wm_png_bytes)), "B4")
            except Exception:
                pass
        ws.protection.sheet = True
        ws.protection.password = "AKP_IZOD_PROTECTED"
        ws.protection.enable()

    ws1.append([_sanitize_cell(wm_stamp)])
    ws1.merge_cells("A1:E1")
    ws1["A1"].font = Font(name="Calibri", size=9, italic=True, color="64748B")

    ws1.append(["АНАЛІТИЧНИЙ ЗВІТ ЗА РЕЗУЛЬТАТАМИ ОПИТУВАННЯ"])
    ws1.merge_cells("A2:E2")
    ws1["A2"].font = Font(name="Calibri", size=14, bold=True, color="0B2A5B")
    ws1.append([])

    title_a = res.get("a", {}).get("title", "Форма А")
    title_b = res.get("b", {}).get("title", "Форма Б")
    ws1.append(["Параметр", "Хвиля А (базова)", "Хвиля Б (порівняння)", "Різниця / Примітка"])
    for col in range(1, 5):
        cell = ws1.cell(row=4, column=col)
        cell.font = header_font
        cell.fill = navy_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    ws1.append([_sanitize_cell("Назва форми"), _sanitize_cell(title_a), _sanitize_cell(title_b), ""])
    ws1.append([_sanitize_cell("Кількість респондентів"), res.get("n_a", 0), res.get("n_b", 0), f"Δ {res.get('n_b', 0) - res.get('n_a', 0)}"])
    ws1.append([_sanitize_cell("Поріг анонімності"), f"≥ {res.get('min_group', 5)}", f"≥ {res.get('min_group', 5)}", "Дотримано"])
    ws1.append([])

    # Scale questions
    scale_q = [q for q in res.get("questions", []) if q.get("kind") == "scale"]
    if scale_q:
        ws1.append(["ШКАЛЬНІ ПОКАЗНИКИ ТА СЕРЕДНІ БАЛИ"])
        r_idx = ws1.max_row
        ws1.cell(row=r_idx, column=1).font = Font(name="Calibri", size=12, bold=True, color="0B2A5B")
        ws1.append(["Питання", "Середній бал А", "Середній бал Б", "Динаміка (+/-)"])
        r_hdr = ws1.max_row
        for col in range(1, 5):
            c = ws1.cell(row=r_hdr, column=col)
            c.font = header_font
            c.fill = accent_fill

        for sq in scale_q:
            ws1.append([_sanitize_cell(sq["clean_title"]), sq.get("mean_a"), sq.get("mean_b"), sq.get("delta")])
        ws1.append([])

    # Largest shifts
    choice_q = [q for q in res.get("questions", []) if q.get("kind") == "choice"]
    shifts = []
    for cq in choice_q:
        for opt in cq.get("options", []):
            shifts.append({
                "q": cq["clean_title"],
                "opt": opt["option"],
                "a": opt["a"]["pct"],
                "b": opt["b"]["pct"],
                "delta": opt["delta_pp"],
            })
    shifts.sort(key=lambda x: abs(x["delta"]), reverse=True)

    if shifts:
        ws1.append(["НАЙБІЛЬШІ ЗСУВИ У ВІДПОВІДЯХ РЕСПОНДЕНТІВ (ТОП-10)"])
        r_idx = ws1.max_row
        ws1.cell(row=r_idx, column=1).font = Font(name="Calibri", size=12, bold=True, color="0B2A5B")
        ws1.append(["Питання", "Варіант відповіді", "% у Хвилі А", "% у Хвилі Б", "Зміна (п.п.)"])
        r_hdr = ws1.max_row
        for col in range(1, 6):
            c = ws1.cell(row=r_hdr, column=col)
            c.font = header_font
            c.fill = navy_fill

        for s in shifts[:10]:
            ws1.append([_sanitize_cell(s["q"]), _sanitize_cell(s["opt"]), f"{s['a']}%", f"{s['b']}%", f"{s['delta']:+} п.п."])

    # Sheet 2: Detailed distributions
    ws2.append([_sanitize_cell(wm_stamp)])
    ws2.merge_cells("A1:F1")
    ws2["A1"].font = Font(name="Calibri", size=9, italic=True, color="64748B")

    ws2.append(["Питання", "Обов'язкове", "Варіант відповіді", f"{title_a} (n / %)", f"{title_b} (n / %)", "Зміна (п.п.)"])
    for col in range(1, 7):
        c = ws2.cell(row=2, column=col)
        c.font = header_font
        c.fill = navy_fill
        c.alignment = Alignment(horizontal="center")

    for q in res.get("questions", []):
        opts = q.get("options", [])
        is_mand_str = "Так" if q.get("is_mandatory") else "Ні"
        for idx, o in enumerate(opts):
            a_info = f"{o['a']['n']} ({o['a']['pct']}%)"
            b_info = f"{o['b']['n']} ({o['b']['pct']}%)"
            d_str = f"{o['delta_pp']:+} п.п."
            ws2.append([
                _sanitize_cell(q["clean_title"]) if idx == 0 else "",
                is_mand_str if idx == 0 else "",
                _sanitize_cell(o["option"]),
                a_info,
                b_info,
                d_str,
            ])

    # Set column widths
    for ws in (ws1, ws2):
        ws.column_dimensions["A"].width = 38
        ws.column_dimensions["B"].width = 24
        ws.column_dimensions["C"].width = 24
        ws.column_dimensions["D"].width = 18
        ws.column_dimensions["E"].width = 18
        ws.column_dimensions["F"].width = 16

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def survey_docx(res: dict, user_profile=None) -> bytes:
    """Генерація офіційного Word-звіту порівняння опитувань за ДСТУ 4163:2020."""
    from . import docgen as D
    from .models import Program, SystemSettings

    pr = Program.objects.select_related("organ", "coordinator_unit").first()
    organ_name = pr.organ.name.replace(" (вигадане)", "") if pr and pr.organ else "Харківський національний університет внутрішніх справ"
    coord_name = pr.coordinator_unit.name if pr and pr.coordinator_unit else "Сектор з питань запобігання та виявлення корупції"

    doc = D.new_document()

    # Водяний знак / гриф
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    u_code = getattr(user_profile, "code", "SYS")
    u_role = getattr(user_profile, "role", "ANAL")
    wm_line = f"{u_role} · {u_code} · {now_str} · ДСК"

    D.apply_watermark_and_protection(doc, user_profile)

    D.para(doc, "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ", indent=False, align="right", bold=True, size=10)
    D.para(doc, wm_line, indent=False, align="right", italic=True, size=8.5)
    doc.add_paragraph()

    D.org_header(doc, organ_name, coord_name)
    doc.add_paragraph()

    D.para(doc, "АНАЛІТИЧНИЙ ЗВІТ", indent=False, align="center", bold=True, size=14, upper=True)
    title_a = res.get("a", {}).get("title", "Форма А")
    title_b = res.get("b", {}).get("title", "Форма Б")
    D.para(doc, f"за результатами порівняння хвиль анонімного анкетування:\n«{title_a}» та «{title_b}»", indent=False, align="center", bold=True, size=12)
    doc.add_paragraph()

    D.para(doc, f"Моніторингове порівняння здійснено відповідно до Закону України «Про запобігання корупції» та вимог антикорупційної програми університету. Загальна кількість опитаних респондентів у базі становить {res.get('n_a', 0)} осіб, у контрольній хвилі порівняння — {res.get('n_b', 0)} осіб. Для безумовного збереження анонімності відповіді згруповано із мінімальним числовим порогом не менше {res.get('min_group', 5)} респондентів у кожній групі.", indent=True, align="justify")

    # Шкальні питання
    scale_q = [q for q in res.get("questions", []) if q.get("kind") == "scale"]
    if scale_q:
        doc.add_paragraph()
        D.heading(doc, "1. Динаміка шкальних оцінок респондентів", level=2)
        s_headers = ["№", "Питання (індикатор)", f"Хвиля А (n={res.get('n_a')})", f"Хвиля Б (n={res.get('n_b')})", "Динаміка"]
        s_rows = []
        for i, sq in enumerate(scale_q, start=1):
            s_rows.append([
                str(i),
                sq["clean_title"],
                f"{sq.get('mean_a', '—')} б.",
                f"{sq.get('mean_b', '—')} б.",
                f"{sq.get('delta', 0):+} б." if sq.get("delta") is not None else "—",
            ])
        D.table(doc, s_headers, s_rows, widths_mm=[10, 85, 25, 25, 25])

    # Ключові зміни
    choice_q = [q for q in res.get("questions", []) if q.get("kind") == "choice"]
    shifts = []
    for cq in choice_q:
        for opt in cq.get("options", []):
            shifts.append({
                "q": cq["clean_title"],
                "opt": opt["option"],
                "a": opt["a"]["pct"],
                "b": opt["b"]["pct"],
                "delta": opt["delta_pp"],
            })
    shifts.sort(key=lambda x: abs(x["delta"]), reverse=True)

    if shifts:
        doc.add_paragraph()
        D.heading(doc, "2. Ключові зсуви у структурі відповідей", level=2)
        sh_headers = ["№", "Формулювання питання", "Варіант відповіді", "Хвиля А, %", "Хвиля Б, %", "Зміна, п.п."]
        sh_rows = []
        for i, sh in enumerate(shifts[:8], start=1):
            sh_rows.append([
                str(i),
                sh["q"][:80] + ("…" if len(sh["q"]) > 80 else ""),
                sh["opt"],
                f"{sh['a']}%",
                f"{sh['b']}%",
                f"{sh['delta']:+} п.п.",
            ])
        D.table(doc, sh_headers, sh_rows, widths_mm=[8, 65, 45, 18, 18, 18])

    # Детальний розподіл за питаннями
    doc.add_paragraph()
    D.heading(doc, "3. Детальні таблиці розподілу відповідей", level=2)
    for q in res.get("questions", []):
        if q.get("kind") not in ("choice", "scale"):
            continue
        mand_label = " (обов'язкове)" if q.get("is_mandatory") else ""
        D.para(doc, f"• {q['clean_title']}{mand_label}", indent=False, bold=True)
        q_hdr = ["Варіант відповіді", f"{title_a} (n / %)", f"{title_b} (n / %)", "Різниця"]
        q_rows = []
        for o in q.get("options", []):
            q_rows.append([
                o["option"],
                f"{o['a']['n']} ({o['a']['pct']}%)",
                f"{o['b']['n']} ({o['b']['pct']}%)",
                f"{o['delta_pp']:+} п.п.",
            ])
        D.table(doc, q_hdr, q_rows, widths_mm=[85, 30, 30, 25])
        doc.add_paragraph()

    # Реквізити підписів
    sig1, sig2 = SystemSettings.signatories()
    doc.add_paragraph()
    D.signature(doc, ["Уповноважена особа з питань", "запобігання та виявлення корупції"], sig1)
    doc.add_paragraph()
    D.signature(doc, ["Керівник закладу вищої освіти"], sig2)

    return D.to_bytes(doc)
