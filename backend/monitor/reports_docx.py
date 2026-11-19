"""Звіти у форматі Word за ДСТУ 4163:2020: аналітична довідка і друкована форма звіту для НАЗК."""
from collections import Counter

from docx.shared import Mm

from . import docgen as D
from . import rules as R
from .models import Program, ReportingPeriod, Section, SystemSettings

QUARTER_WORDS = {1: "І квартал", 2: "ІІ квартал", 3: "ІІІ квартал", 4: "IV квартал"}
HALF_WORDS = {1: "І півріччя", 2: "ІІ півріччя"}


def _num(v):
    return R._num(v).replace(".", ",")


def _pc(v):
    return f"{v:g}".replace(".", ",")


def note_docx(period: ReportingPeriod, user_profile=None) -> bytes:
    note = R.analytic_note(period)
    mon, risks, recs, fc = note["monitoring"], note["risks"], note["recommendations"], note["flags_count"]
    pr = Program.objects.select_related("organ", "coordinator_unit").first()
    today = SystemSettings.today()
    c, p = mon["counts"], mon["percent"]

    doc = D.new_document()
    if user_profile and getattr(user_profile, "role", None) == "ANAL":
        D.apply_analyst_watermark(doc, user_profile)
        D.para(doc, f"ANAL · {user_profile.code} · ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ · ІзОД", indent=False, align="right", bold=True, size=9.5)
    D.org_header(doc, pr.organ.name.replace(" (вигадане)", ""), pr.coordinator_unit.name if pr.coordinator_unit else None)
    D.para(doc, "ДОВІДКА", indent=False, align="center", bold=True)
    doc.add_paragraph()
    dp = D.para(doc, "", indent=False, align="left")
    dp.paragraph_format.tab_stops.add_tab_stop(Mm(110))
    dp.add_run(f"{D.ddmmyyyy(today)}\t№ ________").font.name = D.FONT
    doc.add_paragraph()
    D.para(doc, f"Про стан виконання антикорупційної програми\nза {QUARTER_WORDS[period.quarter]} {period.year} року".replace("\n", " "),
           indent=False, align="left", bold=True)
    doc.add_paragraph()

    D.para(doc, f"Відповідно до даних, внесених структурними підрозділами — виконавцями заходів, станом на "
                f"{D.ddmmyyyy(period.end)} стан виконання {pr.name} (далі — Програма) такий.")

    D.para(doc, "1. Загальний стан виконання Програми", bold=True, keep_next=True)
    D.para(doc, f"Програма містить {mon['total']} заходів. Виконано {c['vykonano']} ({_pc(p['vykonano'])} %), частково виконано "
                f"{c['chastkovo']} ({_pc(p['chastkovo'])} %), перебувають на стадії виконання {c['v_roboti']} ({_pc(p['v_roboti'])} %), "
                f"не виконано {c['portal_not_done']} ({_pc(p['ne_vykonano'])} %), строк виконання не настав для {c['not_due']} "
                f"({_pc(p['not_due'])} %) заходів.")
    D.para(doc, f"За строком, визначеним Програмою, прострочено {c['overdue']} заходів ({_pc(p['overdue'])} %). Строк виконання "
                f"переносився для {c['postponed']} заходів ({_pc(p['postponed'])} %). З виконаних заходів, строк яких визначено "
                f"датою, вчасно виконано {c['done_on_time']}, із порушенням строку — {c['done_late']}.")
    D.para(doc, f"Інформацію про виконання внесено щодо {c['entered']} заходів ({_pc(p['entered'])} %), погоджено "
                f"координатором Програми — {c['approved']} ({_pc(p['approved'])} %).", space_after=6)
    D.table(doc, ["Показник", "Кількість", "Частка, %"], [
        ["Виконано", c["vykonano"], _pc(p["vykonano"])],
        ["Частково виконано", c["chastkovo"], _pc(p["chastkovo"])],
        ["На стадії виконання", c["v_roboti"], _pc(p["v_roboti"])],
        ["Не виконано", c["portal_not_done"], _pc(p["ne_vykonano"])],
        ["Строк виконання не настав", c["not_due"], _pc(p["not_due"])],
        ["Прострочено за строком Програми", c["overdue"], _pc(p["overdue"])],
        ["Строк перенесено", c["postponed"], _pc(p["postponed"])],
    ], widths_mm=[110, 30, 30])

    D.para(doc, "2. Стан корупційних ризиків", bold=True, keep_next=True)
    D.para(doc, "Результативність Програми оцінено за зміною індикаторів стану корупційних ризиків, на усунення яких "
                "спрямовано заходи, а не за кількістю закритих заходів. Частка пройденого шляху — це зміна індикатора "
                "від базового значення до цільового.", space_after=6)
    D.table(doc, ["Код", "Корупційний ризик", "Рівень", "Індикатор: базове → поточне (ціль)", "Пройдено шляху", "Висновок"],
            [[r["code"], r["name"], r["level"],
              f"{_num(r['baseline'])} → {_num(r['current'])} ({_num(r['target'])} {r['unit']})",
              "—" if r["progress"] is None else f"{round(r['progress'] * 100)} %", r["verdict"]] for r in risks],
            widths_mm=[14, 50, 20, 34, 18, 30])
    stuck = [r for r in risks if r["verdict"] in ("не змінюється", "без заходів") and r["level"] in ("високий", "критичний")]
    if stuck:
        D.para(doc, "Стан ризиків високого і критичного рівня " + ", ".join(r["code"] for r in stuck) +
               " не змінюється або щодо них не передбачено заходів, що потребує першочергового реагування.")

    D.para(doc, "3. Проблемні питання", bold=True, keep_next=True)
    D.para(doc, f"За результатами автоматичної перевірки даних за явними правилами виявлено {sum(fc.values())} сигналів про відхилення:")
    for code, n in sorted(fc.items()):
        D.bullet(doc, f"{R.rules()['flags'][code]['title'].lower()} ({code}) — {n};")

    D.para(doc, "4. Пропозиції", bold=True, keep_next=True)
    D.para(doc, "З урахуванням викладеного пропонується:")
    for i, r in enumerate(recs, 1):
        D.bullet(doc, r["proposed_action"].rstrip(".") + (";" if i < len(recs) else "."), numbered=True, n=i)

    sig1, _ = SystemSettings.signatories()
    D.signature(doc, ["Головний спеціаліст сектору з питань", "запобігання та виявлення корупції"], name=sig1)
    return D.to_bytes(doc)


def portal_docx(year: int, half: int, user_profile=None, base_url: str = "") -> bytes:
    from . import verification as V
    pr = Program.objects.select_related("organ").first()
    rows = R.portal_report(pr, year, half)
    doc = D.new_document(landscape=True)
    if user_profile and getattr(user_profile, "role", None) == "ANAL":
        D.apply_analyst_watermark(doc, user_profile)
        D.para(doc, f"ANAL · {user_profile.code} · ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ · ІзОД", indent=False, align="right", bold=True, size=9.5)
    elif pr.restricted_info:
        D.para(doc, "Гриф обмеження доступу (проставляється відповідно до законодавства)", indent=False, align="right", size=12)
    D.org_header(doc, pr.organ.name.replace(" (вигадане)", ""))
    D.para(doc, "ЗВІТ", indent=False, align="center", bold=True)
    D.para(doc, f"про виконання антикорупційної програми за {HALF_WORDS[half]} {year} року", indent=False, align="center", bold=True)
    D.para(doc, pr.name, indent=False, align="center")
    doc.add_paragraph()
    widths = [12, 62, 38, 28, 24, 25, 68]
    for sec in Section.objects.filter(program=pr):
        D.para(doc, f"Розділ {sec.number}. {sec.portal_name}", indent=False, align="left", bold=True, keep_next=True, space_after=6)
        D.table(doc, ["№ з/п", "Опис заходу", "Найменування структурного підрозділу, відповідального за виконання заходу",
                      "Запланований строк виконання заходу", "Фактичний строк виконання", "Стан виконання",
                      "Опис результату виконання заходу або пояснення причин невиконання"],
                [[r["nomer"], r["opys_zakhodu"], r["naimenuvannia_pidrozdilu"], r["zaplanovanyi_strok"],
                  D.ddmmyyyy(r["faktychnyi_strok_vykonannia"]), r["stan_vykonannia"], r["opys_rezultatu_abo_prychyn"]]
                 for r in rows if r["rozdil_portal"] == sec.portal_name], widths_mm=widths, size=10)
    sig1, sig2 = SystemSettings.signatories()
    D.signature(doc, ["Уповноважена особа з питань запобігання", "та виявлення корупції"], name=sig1)
    D.signature(doc, ["Керівник органу"], name=sig2)

    # Криптографічний зліпок та QR-код верифікації
    snapshot = V.get_or_create_portal_snapshot(year, half, user_profile)
    b_url = (base_url or "https://akpmonitor.dev").rstrip("/")
    verify_url = f"{b_url}/verify?id={snapshot.id}&sig={snapshot.signature}"
    qr_bytes = V.generate_qr_png_bytes(verify_url)
    created_at_str = snapshot.created_at.strftime("%d.%m.%Y %H:%M:%S UTC")
    D.qr_verification_box(
        doc,
        qr_png_bytes=qr_bytes,
        snapshot_id=str(snapshot.id),
        report_hash=snapshot.report_hash,
        signature=snapshot.signature,
        created_at_str=created_at_str,
        verify_url=verify_url,
    )

    return D.to_bytes(doc)
