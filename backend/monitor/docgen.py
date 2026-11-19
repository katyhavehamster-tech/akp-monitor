"""Формування документів Word (.docx) за ДСТУ 4163:2020
«Уніфікована система організаційно-розпорядчої документації. Вимоги до оформлення документів».

Що враховано:
- формат А4; поля: ліве 30 мм, праве 10 мм, верхнє і нижнє 20 мм (п. 6.2);
- гарнітура Times New Roman (п. 7.2): текст 14 пт, таблиці 12 пт;
- абзацний відступ 10 мм (п. 7.7), вирівнювання тексту за шириною;
- найменування організації і назва виду документа — великими літерами;
- дата у форматі ДД.ММ.РРРР;
- сторінки нумеруються з другої, посередині верхнього поля;
- реквізит «Підпис»: найменування посади ліворуч, «Власне імʼя ПРІЗВИЩЕ» праворуч на рівні останнього рядка посади;
- таблиці: заголовок повторюється на кожній сторінці, рядки не розриваються.
"""
from __future__ import annotations

import hashlib
import io
import re
from datetime import date, datetime

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

FONT = "Times New Roman"
TEXT_PT = 14
TABLE_PT = 12
INDENT = Mm(10)


# ---------------------------------------------------------------- базова розмітка
def new_document(landscape: bool = False) -> Document:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = (Mm(297), Mm(210)) if landscape else (Mm(210), Mm(297))
    sec.orientation = WD_ORIENT.LANDSCAPE if landscape else WD_ORIENT.PORTRAIT
    sec.left_margin, sec.right_margin = Mm(30), Mm(10)
    sec.top_margin, sec.bottom_margin = Mm(20), Mm(20)
    sec.header_distance = Mm(10)

    st = doc.styles["Normal"]
    st.font.name = FONT
    st.font.size = Pt(TEXT_PT)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    pf = st.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing = 1.0
    for name in ("Heading 1", "Heading 2", "Heading 3", "Title", "List Bullet", "List Number"):
        s = doc.styles[name]
        s.font.name = FONT
        s.font.color.rgb = None
        rpr = s.element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            rpr.append(rfonts)
        for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            rfonts.set(qn(a), FONT)
        for t in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            if rfonts.get(qn(t)) is not None:
                del rfonts.attrib[qn(t)]
    for name, size in (("Heading 1", 14), ("Heading 2", 14), ("Heading 3", 14)):
        s = doc.styles[name]
        s.font.size = Pt(size)
        s.font.bold = True
        s.font.italic = False
        s.paragraph_format.space_before = Pt(12)
        s.paragraph_format.space_after = Pt(6)
        s.paragraph_format.keep_with_next = True
        s.paragraph_format.first_line_indent = Mm(0)
    _page_numbers(sec)
    return doc


def _page_numbers(sec):
    """Номер сторінки посередині верхнього поля, починаючи з другої."""
    sec.different_first_page_header_footer = True
    p = sec.header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    run.font.name = FONT
    run.font.size = Pt(TABLE_PT)
    for kind, text in (("begin", None), (None, "PAGE"), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)


def generate_watermark_png(stamp: str, width: int = 1400, height: int = 1000) -> bytes:
    """Генерує напівпрозоре фонове зображення з повторюваним діагональним водяним знаком (Pillow)."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    txt_layer = Image.new("RGBA", (width * 2, height * 2), (255, 255, 255, 0))
    draw = ImageDraw.Draw(txt_layer)
    font = ImageFont.load_default()

    fill_color = (130, 140, 155, 45)
    step_x = 440
    step_y = 130
    for y in range(0, height * 2, step_y):
        offset = (y // step_y) % 2 * 180
        for x in range(-120 + offset, width * 2, step_x):
            draw.text((x, y), stamp, fill=fill_color, font=font)

    resample_mode = getattr(Image, "Resampling", Image).BILINEAR
    rotated = txt_layer.rotate(-28, resample=resample_mode)
    start_x = (rotated.width - width) // 2
    start_y = (rotated.height - height) // 2
    cropped = rotated.crop((start_x, start_y, start_x + width, start_y + height))

    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    return buf.getvalue()


def protect_docx(doc: Document):
    """Блокує редагування документа Word (Read-Only режим w:documentProtection)."""
    settings = doc.settings.element
    prot = settings.find(qn("w:documentProtection"))
    if prot is None:
        prot = OxmlElement("w:documentProtection")
        settings.append(prot)
    prot.set(qn("w:edit"), "readOnly")
    prot.set(qn("w:enforcement"), "1")


def apply_watermark_and_protection(doc: Document, user_profile=None, custom_stamp: str | None = None):
    """Додає незнімний фоновий водяний знак (Pillow) у колонтитули та вмикає захист від редагування."""
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    u_code = getattr(user_profile, "code", "SYS")
    u_role = getattr(user_profile, "role", "ANAL")
    h = hashlib.sha256(f"{u_code}:{u_role}:{now_str}".encode()).hexdigest()[:12]
    if u_role == "ANAL":
        stamp = custom_stamp or f"ANAL · {u_code} · {u_role} · {now_str} · ІзОД / ДСК · SHA-256: {h}"
    else:
        stamp = custom_stamp or f"ІзОД / ДСК · {u_code} · {u_role} · {now_str} · SHA-256: {h}"

    png_bytes = generate_watermark_png(stamp)

    for sec in doc.sections:
        is_landscape = (sec.orientation == WD_ORIENT.LANDSCAPE)
        w_mm = Mm(280) if is_landscape else Mm(195)

        # Фоновий водяний знак у колонтитулі
        hdr = sec.header
        p_hdr = hdr.paragraphs[0] if hdr.paragraphs else hdr.add_paragraph()
        r_img = p_hdr.add_run()
        r_img.add_picture(io.BytesIO(png_bytes), width=w_mm)

        # Текстовий колонтитул у підвалі
        foot = sec.footer
        p_foot = foot.paragraphs[0] if foot.paragraphs else foot.add_paragraph()
        p_foot.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r_foot = p_foot.add_run(stamp)
        r_foot.font.name = FONT
        r_foot.font.size = Pt(8.5)
        r_foot.font.italic = True
        r_foot.font.color.rgb = RGBColor(110, 110, 110)

        if sec.different_first_page_header_footer:
            f_hdr = sec.first_page_header
            p_f_hdr = f_hdr.paragraphs[0] if f_hdr.paragraphs else f_hdr.add_paragraph()
            r_f_img = p_f_hdr.add_run()
            r_f_img.add_picture(io.BytesIO(png_bytes), width=w_mm)

            f_foot = sec.first_page_footer
            p_f_foot = f_foot.paragraphs[0] if f_foot.paragraphs else f_foot.add_paragraph()
            p_f_foot.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            r_f_foot = p_f_foot.add_run(stamp)
            r_f_foot.font.name = FONT
            r_f_foot.font.size = Pt(8.5)
            r_f_foot.font.italic = True
            r_f_foot.font.color.rgb = RGBColor(110, 110, 110)

    # Вмикаємо захист документа Word від редагування
    protect_docx(doc)


def apply_analyst_watermark(doc: Document, user_profile=None):
    """Сумісність: викликає apply_watermark_and_protection з даними користувача."""
    apply_watermark_and_protection(doc, user_profile)


def _runs(p, text: str, size=None, bold=None, italic=None):
    """Додає текст із підтримкою **жирного** та `коду` (без символів розмітки у результаті)."""
    parts = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            r = p.add_run(part[2:-2])
            r.bold = True
        elif part.startswith("`") and part.endswith("`"):
            r = p.add_run(part[1:-1])
        else:
            r = p.add_run(part)
            if bold is not None:
                r.bold = bold
        r.font.name = FONT
        if size:
            r.font.size = Pt(size)
        if italic:
            r.italic = True
    return p


def para(doc, text="", *, indent=True, align="justify", bold=None, size=None, space_after=0, keep_next=False,
         italic=False, upper=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.first_line_indent = INDENT if indent else Mm(0)
    pf.space_after = Pt(space_after)
    pf.keep_with_next = keep_next
    p.alignment = {"justify": WD_ALIGN_PARAGRAPH.JUSTIFY, "left": WD_ALIGN_PARAGRAPH.LEFT,
                   "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT}[align]
    if text:
        _runs(p, text.upper() if upper else text, size=size, bold=bold, italic=italic)
    return p


def heading(doc, text, level=1):
    h = doc.add_heading(level=level)
    h.alignment = WD_ALIGN_PARAGRAPH.LEFT
    _runs(h, text)
    return h


def bullet(doc, text, numbered=False, n=None):
    """Перелік: «–» або «1)» з абзацного відступу, як прийнято в діловодстві."""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.first_line_indent = INDENT
    _runs(p, (f"{n}) " if numbered else "– ") + text)
    return p


def table(doc, header: list[str], rows: list[list], widths_mm: list[float] | None = None, size=TABLE_PT):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0]
    _repeat_header(hdr)
    for i, h in enumerate(header):
        c = hdr.cells[i]
        c.text = ""
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(str(h))
        r.bold = True
        r.font.size = Pt(size)
        r.font.name = FONT
    for row in rows:
        cells = t.add_row()
        _cant_split(cells)
        for i, v in enumerate(row):
            c = cells.cells[i]
            c.text = ""
            p = c.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            _runs(p, "" if v is None else str(v), size=size)
    total = text_width(doc)
    if not widths_mm:
        # ширина колонок пропорційна довжині тексту, але не менше 15 мм
        def score(i):
            cells = [str(header[i])] + [str(r[i] or "") for r in rows[:60]]
            longest_word = max((len(w) for c in cells for w in c.split()), default=4)
            mean = sum(len(c) for c in cells[1:]) / max(1, len(cells) - 1)
            return max(longest_word + 2, min(mean * 1.1, 70), 6)
        lens = [score(i) for i in range(len(header))]
        widths_emu = [int(total * l / sum(lens)) for l in lens]
    else:
        k = total / sum(Mm(w) for w in widths_mm)
        widths_emu = [int(Mm(w) * k) for w in widths_mm]
    _fixed_widths(t, widths_emu)
    doc.add_paragraph()
    return t


def _fixed_widths(t, widths_emu):
    """Фіксовані ширини колонок (tblGrid + tcW + layout fixed): однаково у Word і LibreOffice."""
    t.autofit = False
    tbl = t._tbl
    tblPr = tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(int(sum(widths_emu) / 635)))
    grid = tbl.tblGrid
    for i, gc in enumerate(grid.findall(qn("w:gridCol"))):
        gc.set(qn("w:w"), str(int(widths_emu[i] / 635)))
    for row in t.rows:
        for i, c in enumerate(row.cells):
            c.width = widths_emu[i]


def _repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def _cant_split(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:cantSplit")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def text_width(doc) -> int:
    s = doc.sections[0]
    return s.page_width - s.left_margin - s.right_margin


def signature(doc, position_lines: list[str], name: str = "Олександр КОВАЛЕНКО"):
    """Реквізит «Підпис»: посада ліворуч, імʼя праворуч на рівні останнього рядка посади."""
    doc.add_paragraph()
    doc.add_paragraph()
    for i, line in enumerate(position_lines):
        p = doc.add_paragraph()
        p.paragraph_format.keep_with_next = i < len(position_lines) - 1
        p.paragraph_format.tab_stops.add_tab_stop(text_width(doc), WD_TAB_ALIGNMENT.RIGHT)
        r = p.add_run(line)
        r.font.name = FONT
        if i == len(position_lines) - 1:
            r2 = p.add_run("\t" + name)
            r2.font.name = FONT


def org_header(doc, organ: str, unit: str | None = None):
    para(doc, organ, indent=False, align="center", bold=True, upper=True)
    if unit:
        para(doc, unit, indent=False, align="center")
    doc.add_paragraph()


def to_bytes(doc) -> bytes:
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def ddmmyyyy(d) -> str:
    if not d:
        return ""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return d.strftime("%d.%m.%Y")


# ---------------------------------------------------------------- Markdown → DOCX (для документів команди)
def markdown_to_docx(md: str, doc=None, title_page: dict | None = None) -> Document:
    """Перетворює простий Markdown (заголовки, абзаци, переліки, таблиці, блоки коду) на документ
    за ДСТУ 4163:2020. Символи розмітки (**, |, #, `) у результат не потрапляють."""
    doc = doc or new_document()
    lines = md.splitlines()
    i = 0
    num = 0
    while i < len(lines):
        line = lines[i].rstrip()
        s = line.strip()
        if not s:
            num = 0
            i += 1
            continue
        if s.startswith("```"):
            i += 1
            block = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            for b in block:
                p = doc.add_paragraph()
                p.paragraph_format.first_line_indent = Mm(0)
                r = p.add_run(b if b.strip() else " ")
                r.font.name = "Courier New"
                r.font.size = Pt(9)
            doc.add_paragraph()
            continue
        if s.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i].strip())
                i += 1
            rows = [[_clean(c) for c in r.strip("|").split("|")] for r in block
                    if not re.match(r"^\|[\s:\-|]+\|$", r)]
            if rows:
                header, body = rows[0], rows[1:]
                body = [r + [""] * (len(header) - len(r)) for r in body]
                table(doc, header, [r[:len(header)] for r in body])
            continue
        m = re.match(r"^(#{1,4})\s+(.*)", s)
        if m:
            lvl = len(m.group(1))
            text = _clean(m.group(2))
            if lvl == 1:
                para(doc, text, indent=False, align="center", bold=True, space_after=12, keep_next=True)
            else:
                heading(doc, text, min(lvl - 1, 3))
            i += 1
            continue
        if s.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            para(doc, _clean(" ".join(buf)), italic=True)
            continue
        m = re.match(r"^(?:[-*]|(\d+)[.)])\s+(.*)", s)
        if m:
            buf = [m.group(2)]
            i += 1
            # продовження пункту переліку — рядки з відступом
            while i < len(lines) and lines[i].startswith((" ", "\t")) and lines[i].strip() \
                    and not re.match(r"^([-*]|\d+[.)])\s", lines[i].strip()):
                buf.append(lines[i].strip())
                i += 1
            if m.group(1):
                bullet(doc, _clean(" ".join(buf)), numbered=True, n=m.group(1))
            else:
                bullet(doc, _clean(" ".join(buf)))
            continue
        # звичайний абзац: склеюємо послідовні рядки
        buf = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||[-*]\s|\d+[.)]\s|```|>)", lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        para(doc, _clean(" ".join(buf)))
    return doc


def _clean(t: str) -> str:
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)          # зображення
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)     # посилання → текст
    t = t.replace("<br>", " ").replace("<br/>", " ")
    t = re.sub(r"(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)", r"\1", t)  # курсив *x*
    return t.strip()


def qr_verification_box(doc, qr_png_bytes: bytes, snapshot_id: str, report_hash: str, signature: str, created_at_str: str, verify_url: str):
    """Додає блок електронної верифікації з QR-кодом та криптографічним HMAC-підписом у кінець Word-документа."""
    import io
    from docx.shared import Mm, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    doc.add_paragraph()
    t = doc.add_table(rows=1, cols=2)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER

    w_total = text_width(doc)
    w_qr = Mm(36)
    w_info = w_total - w_qr

    row = t.rows[0]
    cell_qr = row.cells[0]
    cell_qr.width = w_qr
    cell_info = row.cells[1]
    cell_info.width = w_info

    p_qr = cell_qr.paragraphs[0]
    p_qr.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_qr.paragraph_format.space_before = Pt(4)
    p_qr.paragraph_format.space_after = Pt(2)
    p_qr.paragraph_format.line_spacing = 1.0
    r_qr = p_qr.add_run()
    r_qr.add_picture(io.BytesIO(qr_png_bytes), width=Mm(30))

    p_hint = cell_qr.add_paragraph()
    p_hint.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_hint.paragraph_format.space_before = Pt(0)
    p_hint.paragraph_format.space_after = Pt(4)
    p_hint.paragraph_format.line_spacing = 1.0
    r_hint = p_hint.add_run("Відскануйте для перевірки")
    r_hint.font.name = FONT
    r_hint.font.size = Pt(8)
    r_hint.font.italic = True
    r_hint.font.color.rgb = RGBColor(100, 100, 100)

    p_title = cell_info.paragraphs[0]
    p_title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p_title.paragraph_format.space_before = Pt(4)
    p_title.paragraph_format.space_after = Pt(2)
    p_title.paragraph_format.line_spacing = 1.0
    r_title = p_title.add_run("ЕЛЕКТРОННА ВЕРИФІКАЦІЯ ТА ЦІЛІСНІСТЬ ЗВІТУ")
    r_title.bold = True
    r_title.font.name = FONT
    r_title.font.size = Pt(9.5)

    p_sub = cell_info.add_paragraph()
    p_sub.paragraph_format.space_before = Pt(0)
    p_sub.paragraph_format.space_after = Pt(3)
    p_sub.paragraph_format.line_spacing = 1.0
    r_sub = p_sub.add_run("Документ зафіксовано в системі «АКП-Монітор» та підписано HMAC-SHA256 ключем сервера.")
    r_sub.font.name = FONT
    r_sub.font.size = Pt(8.5)
    r_sub.font.italic = True

    lines = [
        ("ID зліпка: ", str(snapshot_id)),
        ("SHA-256 хеш даних: ", report_hash),
        ("Підпис HMAC-SHA256: ", signature),
        ("Дата та час фіксації: ", created_at_str),
        ("Онлайн-перевірка: ", verify_url),
    ]
    for label, val in lines:
        p_line = cell_info.add_paragraph()
        p_line.paragraph_format.space_before = Pt(0)
        p_line.paragraph_format.space_after = Pt(1.5)
        p_line.paragraph_format.line_spacing = 1.0
        r_lbl = p_line.add_run(label)
        r_lbl.bold = True
        r_lbl.font.name = FONT
        r_lbl.font.size = Pt(8)
        r_val = p_line.add_run(val)
        r_val.font.name = "Courier New" if ("хеш" in label.lower() or "підпис" in label.lower() or "id" in label.lower()) else FONT
        r_val.font.size = Pt(7.5 if len(val) > 40 else 8)
        if "перевірка" in label.lower():
            r_val.font.color.rgb = RGBColor(0, 68, 148)
            r_val.underline = True

    return t
