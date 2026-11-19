"""Тести: python manage.py test monitor"""
from datetime import date

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from monitor.models import (AuditLog, Evidence, Measure, Profile, Program,
                            ReportingPeriod, ReportSnapshot, Role, Survey, SystemSettings, Unit)
from monitor.selfcheck import run_selfcheck
from monitor.surveys import (EMPTY_ANSWER_LABEL, DONT_KNOW_LABEL, NO_RISKS_LABEL,
                             compare, normalize_answer_value, parse_csv, parse_survey_file,
                             survey_docx, survey_xlsx)


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("import_dataset", verbosity=0)

    def client_for(self, code):
        c = APIClient()
        r = c.post("/api/auth/login", {"username": code, "password": "demo"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        c.credentials(HTTP_AUTHORIZATION="Token " + r.json()["token"])
        return c


class SelfCheck(Base):
    def test_flags_match_organizers_key(self):
        r = run_selfcheck()["flags"]
        self.assertEqual(r["missing"], [])
        self.assertEqual(r["extra"], [])
        self.assertEqual(r["matched"], 29)

    def test_portal_report_matches_etalon(self):
        r = run_selfcheck()["report"]
        self.assertTrue(r["ok"], r["differences"][:5])


class Access(Base):
    def test_executor_sees_only_own_unit(self):
        c = self.client_for("u-010")  # виконавець P05
        items = c.get("/api/measures").json()["items"]
        self.assertTrue(items)
        self.assertTrue(all(i["unit"]["code"] == "P05" for i in items))
        other = c.get("/api/measures/Z-01")
        self.assertEqual(other.status_code, 403)

    def test_manager_read_only(self):
        c = self.client_for("u-004")
        self.assertEqual(len(c.get("/api/measures").json()["items"]), 50)
        r = c.post("/api/measures/Z-05/execution", {"status": "vykonano"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_surveys_only_for_authorized_person(self):
        for code in ("u-004", "u-006"):
            self.assertEqual(self.client_for(code).get("/api/surveys").status_code, 403, code)
        self.assertEqual(self.client_for("u-001").get("/api/surveys").status_code, 200)
        self.assertEqual(self.client_for("u-002").get("/api/surveys").status_code, 200)
        self.assertEqual(self.client_for("u-005").get("/api/surveys").status_code, 200)

    def test_tech_admin_cannot_change_content(self):
        # Звичайний користувач (наприклад, керівник u-004 або виконавець u-006) не може змінювати параметри заходу
        c = self.client_for("u-004")
        self.assertEqual(c.patch("/api/measures/Z-01", {"content": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client_for("u-001").get("/api/users").status_code, 200)

    def test_executor_window(self):
        c = self.client_for("u-010")
        code = c.get("/api/measures").json()["items"][0]["code"]
        r = c.post(f"/api/measures/{code}/execution", {"period": "2026-Q2", "status": "v_roboti",
                                                        "result_text": "Тест 1"}, format="json")
        # демо-дата 03.07.2026 — вікно Q2 (01–05.07) відкрите
        self.assertIn(r.status_code, (200, 403))
        s = SystemSettings.get()
        s.today_override = date(2026, 8, 15)
        s.save()
        r = c.post(f"/api/measures/{code}/execution", {"period": "2026-Q2", "status": "v_roboti"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_recommendation_requires_owner_and_deadline(self):
        c = self.client_for("u-002")
        items = c.get("/api/recommendations?period=2026-Q2").json()["items"]
        self.assertTrue(items)
        rid = items[0]["id"]
        self.assertEqual(c.post(f"/api/recommendations/{rid}/decide", {"state": "accepted"}, format="json").status_code, 400)
        ok = c.post(f"/api/recommendations/{rid}/decide",
                    {"state": "accepted", "responsible_unit": "P01", "due_date": "2026-09-30"}, format="json")
        self.assertEqual(ok.status_code, 200)


class Integrity(Base):
    def test_audit_chain_detects_tampering(self):
        self.assertTrue(AuditLog.verify_chain()["ok"])
        rec = AuditLog.objects.order_by("id")[10]
        AuditLog.objects.filter(pk=rec.pk).update(new_value="підроблено")
        res = AuditLog.verify_chain()
        self.assertFalse(res["ok"])
        self.assertEqual(res["broken_at"], rec.pk)

    def test_evidence_immutable(self):
        e = Evidence.objects.first()
        e.title = "інша назва"
        with self.assertRaises(ValidationError):
            e.save()
        with self.assertRaises(ValidationError):
            e.delete()


class Surveys(Base):
    def test_email_columns_dropped(self):
        raw = ("Позначка часу,Адреса електронної пошти,Питання\n"
               "01.01.2026,a@b.ua,Так\n02.01.2026,c@d.ua,Ні\n").encode()
        p = parse_csv(raw)
        self.assertEqual(p["questions"], ["Питання"])
        self.assertIn("Адреса електронної пошти", p["dropped"])
        self.assertNotIn("@", str(p["answers"]))

    def test_small_groups_hidden(self):
        a = {"questions": ["Q"], "answers": [{"Q": "Так"}] * 3}
        self.assertTrue(compare(a, a, min_group=5)["hidden"])
        b = {"questions": ["Q"], "answers": [{"Q": "Так"}] * 6}
        self.assertFalse(compare(b, b, min_group=5)["hidden"])

    def test_normalization_uninformative_and_standard_responses(self):
        # а) Відсутня відповідь / Не вказано
        for empty_val in ("", "   ", ".", "….", "—", "?", "+", "Н", "0", "56", "👍", "не відповів", "без коментарів", "гг", "четко"):
            self.assertEqual(normalize_answer_value(empty_val), EMPTY_ANSWER_LABEL, f"Failed for {empty_val}")

        # b) Не знаю / Важко відповісти
        for dk_val in ("не знаю", "незнаю", "навіть не знаю", "невідомо", "важко відповісти", "складно", "хз", "без понятия"):
            self.assertEqual(normalize_answer_value(dk_val), DONT_KNOW_LABEL, f"Failed for {dk_val}")

        # c) Ризики відсутні / Не стикався
        for nr_val in ("ні", "нет", "ніяких", "немає", "нема", "не існує", "відсутні", "ризики відсутні", "не стикався", "все добре",
                       "в університеті немає напрямків діяльності, які можуть бути вразливими..."):
            self.assertEqual(normalize_answer_value(nr_val), NO_RISKS_LABEL, f"Failed for {nr_val}")

        # Змістовні відповіді зберігаються без змін
        meaningful = "Хабарництво при розподілі премій та стипендій"
        self.assertEqual(normalize_answer_value(meaningful), meaningful)

    def test_survey_export_watermark_and_protection(self):
        import io
        import openpyxl
        from docx import Document

        p = Profile.objects.filter(role=Role.ANAL).first()
        res = {
            "a": {"id": 1, "title": "Хвиля 2025"},
            "b": {"id": 2, "title": "Хвиля 2026"},
            "n_a": 40, "n_b": 45, "min_group": 5,
            "questions": [
                {
                    "question": "Q1",
                    "clean_title": "Чи стикалися ви з корупцією?",
                    "kind": "choice",
                    "is_mandatory": True,
                    "options": [
                        {"option": "Так", "a": {"n": 5, "pct": 12.5}, "b": {"n": 3, "pct": 6.7}, "delta_pp": -5.8},
                        {"option": "Ні", "a": {"n": 35, "pct": 87.5}, "b": {"n": 42, "pct": 93.3}, "delta_pp": 5.8},
                    ],
                }
            ],
        }

        # XLSX
        raw_xlsx = survey_xlsx(res, p)
        self.assertGreater(len(raw_xlsx), 1000)
        wb = openpyxl.load_workbook(io.BytesIO(raw_xlsx))
        self.assertIn("Загальні показники", wb.sheetnames)
        self.assertIn("Розподіл відповідей", wb.sheetnames)
        ws1 = wb["Загальні показники"]
        ws2 = wb["Розподіл відповідей"]
        self.assertTrue(ws1.protection.sheet)
        self.assertTrue(ws2.protection.sheet)
        self.assertIn("ANAL", ws1.oddHeader.right.text)

        # DOCX
        raw_docx = survey_docx(res, p)
        self.assertGreater(len(raw_docx), 1000)
        doc = Document(io.BytesIO(raw_docx))
        settings_xml = doc.settings.element.xml
        self.assertIn("w:documentProtection", settings_xml)
        self.assertIn('w:edit="readOnly"', settings_xml)


class Exports(Base):
    def test_all_exports_download(self):
        c = self.client_for("u-002")
        urls = ["reports/portal?year=2026&half=1&format=xlsx", "reports/portal?year=2026&half=1&format=csv",
                "reports/portal?year=2026&half=1&format=docx", "reports/note?period=2026-Q2&format=docx",
                "reports/note?period=2026-Q2&format=md", "reports/internal?period=2026-Q2&format=xlsx",
                "reports/internal?period=2026-Q2&format=csv", "audit/export"]
        for u in urls:
            r = c.get("/api/" + u)
            self.assertEqual(r.status_code, 200, u)
            self.assertIn("attachment", r["Content-Disposition"], u)

    def test_docx_follows_dstu_4163(self):
        import io
        from docx import Document
        from docx.shared import Mm
        r = self.client_for("u-002").get("/api/reports/note?period=2026-Q2&format=docx")
        d = Document(io.BytesIO(r.content))
        s = d.sections[0]
        self.assertEqual((round(s.left_margin.mm), round(s.right_margin.mm), round(s.top_margin.mm),
                          round(s.bottom_margin.mm)), (30, 10, 20, 20))
        self.assertEqual(d.styles["Normal"].font.name, "Times New Roman")
        self.assertTrue(s.different_first_page_header_footer)
        self.assertNotIn("**", "\n".join(p.text for p in d.paragraphs))


class Security(Base):
    def test_user_deletion_preserves_audit_chain_and_comments(self):
        admin_c = self.client_for("u-001")
        r = admin_c.post("/api/users", {
            "code": "U-099", "role": "VYK", "unit": "P05", "password": "demo"
        }, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("full_name", r.json())
        vyk_c = self.client_for("u-099")
        m_code = vyk_c.get("/api/measures").json()["items"][0]["code"]
        self.assertEqual(vyk_c.post(f"/api/measures/{m_code}/comments", {"text": "Коментар виконавця"}, format="json").status_code, 201)
        self.assertEqual(admin_c.delete("/api/users/U-099").status_code, 204)
        self.assertTrue(AuditLog.verify_chain()["ok"])
        comments = admin_c.get(f"/api/measures/{m_code}").json()["comments"]
        self.assertTrue(any(c["author"] == "U-099" for c in comments))

    def test_evidence_blocks_dangerous_files_and_javascript_links_and_enforces_auth(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        koord = self.client_for("u-002")
        bad_file = SimpleUploadedFile("xss.html", b"<script>alert(1)</script>", content_type="text/html")
        r_bad = koord.post("/api/measures/Z-01/evidence", {
            "title": "XSS", "doc_date": "2026-06-01", "file": bad_file
        }, format="multipart")
        self.assertEqual(r_bad.status_code, 400)

        r_js = koord.post("/api/measures/Z-01/evidence", {
            "title": "JS Link", "doc_date": "2026-06-01", "link": "javascript:alert(1)"
        }, format="json")
        self.assertEqual(r_js.status_code, 400)

        good_file = SimpleUploadedFile("nakaz_45.pdf", b"%PDF-1.4 fake test pdf", content_type="application/pdf")
        r_ok = koord.post("/api/measures/Z-01/evidence", {
            "title": "Наказ № 45", "doc_date": "2026-06-01", "file": good_file, "link": "https://nazk.gov.ua/"
        }, format="multipart")
        self.assertEqual(r_ok.status_code, 201, r_ok.content)
        file_url = r_ok.json()["file"]

        # Без авторизації та з чужого підрозділу файл недоступний
        anon = APIClient()
        self.assertIn(anon.get(file_url).status_code, (401, 403))
        self.assertEqual(anon.get("/media/evidence/Z-01/nakaz_45.pdf").status_code, 403)
        other_vyk = self.client_for("u-010")
        self.assertEqual(other_vyk.get(file_url).status_code, 403)

        # Авторизоване завантаження повертає захисні заголовки
        dl = koord.get(file_url)
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(dl["X-Content-Type-Options"], "nosniff")
        self.assertIn("attachment", dl["Content-Disposition"])

    def test_csrf_cookie_issuance_and_auth(self):
        anon = APIClient(enforce_csrf_checks=True)
        # 1. /api/auth/csrf видає csrftoken та встановлює cookie
        r_csrf = anon.get("/api/auth/csrf")
        self.assertEqual(r_csrf.status_code, 200)
        self.assertIn("csrfToken", r_csrf.json())
        token = r_csrf.json()["csrfToken"]
        self.assertTrue(bool(token))
        self.assertIn("csrftoken", anon.cookies)

        # 2. /api/public/overview також видає csrftoken
        r_ov = anon.get("/api/public/overview")
        self.assertEqual(r_ov.status_code, 200)
        self.assertIn("csrfToken", r_ov.json())

        # 3. Вхід за логіном/паролем із передачею X-CSRFToken
        r_login = anon.post("/api/auth/login", {
            "username": "u-002", "password": "demo"
        }, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r_login.status_code, 200, r_login.content)
        self.assertIn("token", r_login.json())

        # 4. Вхід безпосередньо без попередньої сесії
        fresh_client = APIClient(enforce_csrf_checks=True)
        r_direct = fresh_client.post("/api/auth/login", {
            "username": "u-002", "password": "demo"
        }, format="json")
        self.assertEqual(r_direct.status_code, 200, r_direct.content)

    def test_logout_revokes_token_and_login_rate_limit(self):
        from django.core.cache import cache
        cache.clear()
        c = self.client_for("u-005")
        self.assertEqual(c.get("/api/auth/me").status_code, 200)
        self.assertEqual(c.post("/api/auth/logout").status_code, 204)
        self.assertEqual(c.get("/api/auth/me").status_code, 401)

        anon = APIClient()
        for _ in range(10):
            r = anon.post("/api/auth/login", {"username": "u-002", "password": "wrong"}, format="json")
            self.assertEqual(r.status_code, 400)
        r_blocked = anon.post("/api/auth/login", {"username": "u-002", "password": "wrong"}, format="json")
        self.assertEqual(r_blocked.status_code, 429)
        cache.clear()

    def test_admin_self_lockout_and_security_headers_and_csv_injection(self):
        admin_c = self.client_for("u-001")
        self.assertEqual(admin_c.patch("/api/users/U-001", {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(admin_c.patch("/api/users/U-001", {"role": "KER"}, format="json").status_code, 400)
        self.assertEqual(admin_c.patch("/api/settings", {"min_survey_group": 0}, format="json").status_code, 400)

        me_resp = admin_c.get("/api/auth/me")
        self.assertIn("Content-Security-Policy", me_resp)
        self.assertIn("Permissions-Policy", me_resp)
        self.assertIn("no-store", me_resp["Cache-Control"])

        # Перевірка нейтралізації формул у CSV-експорті
        koord = self.client_for("u-002")
        koord.post("/api/measures/Z-01/comments", {"text": "=CMD|' /C calc'!A0"}, format="json")
        csv_text = koord.get("/api/audit/export").content.decode("utf-8-sig")
        self.assertIn("'=CMD|", csv_text)


class ReportVerification(Base):
    def test_report_snapshot_immutability(self):
        c = self.client_for("u-002")
        r = c.get("/api/reports/portal?year=2026&half=1")
        self.assertEqual(r.status_code, 200)
        snap_id = r.json()["snapshot"]["id"]
        snap = ReportSnapshot.objects.get(id=snap_id)

        # Спроба модифікації
        snap.organ_name = "Підроблений орган"
        with self.assertRaises(ValidationError):
            snap.save()

        # Спроба видалення
        with self.assertRaises(ValidationError):
            snap.delete()

    def test_portal_report_creates_snapshot_and_qr(self):
        c = self.client_for("u-002")
        r = c.get("/api/reports/portal?year=2026&half=1")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("snapshot", data)
        snap = data["snapshot"]
        self.assertTrue(snap["id"])
        self.assertTrue(snap["signature"])
        self.assertTrue(snap["qr_code"].startswith("data:image/png;base64,"))
        self.assertIn(f"/verify?id={snap['id']}&sig={snap['signature']}", snap["verify_url"])

    def test_public_verify_endpoint(self):
        c = self.client_for("u-002")
        r = c.get("/api/reports/portal?year=2026&half=1")
        snap = r.json()["snapshot"]

        anon = APIClient()
        # 1. Валідний запит (публічно без авторизації)
        v_ok = anon.get(f"/api/reports/verify?id={snap['id']}&sig={snap['signature']}")
        self.assertEqual(v_ok.status_code, 200)
        v_data = v_ok.json()
        self.assertEqual(v_data["status"], "verified_intact")
        self.assertTrue(v_data["valid_signature"])
        self.assertTrue(v_data["data_matches_current"])
        self.assertEqual(v_data["snapshot"]["id"], snap["id"])

        # 2. Підроблений підпис
        v_tampered = anon.get(f"/api/reports/verify?id={snap['id']}&sig=tampered_signature_123")
        self.assertEqual(v_tampered.status_code, 400)
        self.assertEqual(v_tampered.json()["status"], "invalid_signature")
        self.assertFalse(v_tampered.json()["valid_signature"])

        # 3. Відсутні параметри
        v_missing = anon.get("/api/reports/verify")
        self.assertEqual(v_missing.status_code, 400)

        # 4. Неіснуючий ID зі схожим підписом
        fake_id = "00000000-0000-0000-0000-000000000000"
        v_not_found = anon.get(f"/api/reports/verify?id={fake_id}&sig=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        self.assertEqual(v_not_found.status_code, 404)

    def test_docx_export_contains_qr_verification(self):
        c = self.client_for("u-002")
        r = c.get("/api/reports/portal?year=2026&half=1&format=docx")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r["Content-Type"],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        # Перевірка що вміст docx містить бінарні zip-структури
        self.assertTrue(len(r.content) > 5000)
        self.assertTrue(r.content.startswith(b"PK\x03\x04"))

    def test_read_and_export_audit_trail_in_izod_mode(self):
        """Перевірка журналу переглядів, завантажень та експорту в режимі ІзОД."""
        s = SystemSettings.get()
        s.izod_audit_mode = True
        s.save()
        self.assertTrue(SystemSettings.is_izod_active())

        c = self.client_for("u-002")

        # 1. Відкриття картки заходу
        r_view = c.get("/api/measures/Z-01")
        self.assertEqual(r_view.status_code, 200)

        view_logs = AuditLog.objects.filter(action="перегляд картки заходу", obj_id="Z-01")
        self.assertTrue(view_logs.exists())
        first_count = view_logs.count()

        # 1.1 Перевірка дебоунсу (повторний запит одразу не плодить дублі)
        c.get("/api/measures/Z-01")
        self.assertEqual(AuditLog.objects.filter(action="перегляд картки заходу", obj_id="Z-01").count(), first_count)

        # 2. Експорт звіту Порталу Word
        r_docx = c.get("/api/reports/portal?year=2026&half=1&format=docx")
        self.assertEqual(r_docx.status_code, 200)
        export_logs = AuditLog.objects.filter(action__icontains="експорт звіту Word")
        self.assertTrue(export_logs.exists())

        # 3. Друк звіту через клієнтський ендпоїнт
        r_print = c.post(
            "/api/audit/log-print",
            {"title": "Тестовий друк звіту", "obj_id": "zvit-test", "obj_type": "zvit"},
            format="json",
        )
        self.assertEqual(r_print.status_code, 200)
        print_logs = AuditLog.objects.filter(action__icontains="друк: Тестовий друк звіту")
        self.assertTrue(print_logs.exists())

        # 4. Фільтрація в API за категоріями
        r_cat_views = c.get("/api/audit?category=views")
        self.assertEqual(r_cat_views.status_code, 200)
        self.assertTrue(any("перегляд" in item["action"] for item in r_cat_views.json()["items"]))

        r_cat_export = c.get("/api/audit?category=export")
        self.assertEqual(r_cat_export.status_code, 200)
        self.assertTrue(any("експорт" in item["action"] or "друк" in item["action"] for item in r_cat_export.json()["items"]))

        # 5. Цілісність ланцюжка SHA-256
        chain_res = AuditLog.verify_chain()
        self.assertTrue(chain_res["ok"])
        self.assertGreater(chain_res["checked"], 5)

        # 6. Коли ІзОД вимкнено - перегляд не логується
        s.izod_audit_mode = False
        s.save()
        pr = Program.objects.first()
        if pr:
            pr.restricted_info = False
            pr.save()
        self.assertFalse(SystemSettings.is_izod_active())

        c.get("/api/measures/Z-02")
        self.assertFalse(AuditLog.objects.filter(action="перегляд картки заходу", obj_id="Z-02").exists())

    def test_survey_cp1251_xlsx_normalization_and_export(self):
        """Перевірка парсингу cp1251, .xlsx, нормалізації неінформативних відповідей та експорту."""
        import io
        import openpyxl

        # 1. Тест кирилиці в cp1251
        cp_data = (
            "Позначка часу,Чи стикалися з корупцією?*,Які корупційні ризики помічені?\n"
            "01.09.2026 12:00,Ні,відсутні\n"
            "01.09.2026 12:05,Так,Непрозорі закупівлі\n"
            "01.09.2026 12:10,Ні,-\n"
            "01.09.2026 12:15,Ні,.\n"
            "01.09.2026 12:20,Ні,немає\n"
            "01.09.2026 12:25,Так,Хабарництво при екзаменах\n"
        ).encode("cp1251")
        p_cp = parse_survey_file(cp_data, "test.csv")
        self.assertEqual(len(p_cp["answers"]), 6)
        self.assertEqual(len(p_cp["questions"]), 2)
        self.assertTrue(any("корупцією" in q for q in p_cp["questions"]))

        # 2. Тест імпорту з Excel .xlsx
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Timestamp", "Email", "Чи стикалися з корупцією?*", "Які корупційні ризики помічені?"])
        ws.append(["12.09.2026", "secret@univ.edu", "Ні", "немає"])
        ws.append(["12.09.2026", "user@univ.edu", "Так", "Конфлікт інтересів"])
        ws.append(["12.09.2026", "test@univ.edu", "Ні", "—"])
        ws.append(["12.09.2026", "anon@univ.edu", "Ні", "відсутні"])
        ws.append(["12.09.2026", "officer@univ.edu", "Так", "Зловживання посадою"])
        buf = io.BytesIO()
        wb.save(buf)
        xlsx_bytes = buf.getvalue()

        p_xlsx = parse_survey_file(xlsx_bytes, "survey.xlsx")
        self.assertEqual(len(p_xlsx["answers"]), 5)
        self.assertIn("Email", p_xlsx["dropped"])

        # 3. Порівняння двох хвиль
        res = compare(p_cp, p_xlsx, min_group=5)
        self.assertFalse(res["hidden"])
        self.assertEqual(len(res["questions"]), 2)

        # Перевірка обов'язковості
        q_yesno = next(q for q in res["questions"] if "корупцією" in q["question"])
        self.assertTrue(q_yesno["is_mandatory"])
        self.assertEqual(q_yesno["kind"], "choice")

        # Перевірка нормалізації неінформативних відповідей
        q_text = next(q for q in res["questions"] if "ризики" in q["question"])
        self.assertFalse(q_text["is_mandatory"])
        # Відповіді "-", ".", "немає", "відсутні" повинні бути відсіяні або нормалізовані
        opt_names = [o["option"] for o in q_text["options"]]
        self.assertTrue(all(ans not in {"-", ".", "немає", "відсутні"} for ans in opt_names))
        self.assertIn("Відсутня відповідь / Не вказано", opt_names)

        # 4. Експорт результатів у XLSX та Word
        p_u002 = Profile.objects.get(code="U-002")
        res["a"] = {"title": "Хвиля 1"}
        res["b"] = {"title": "Хвиля 2"}
        xlsx_out = survey_xlsx(res, p_u002)
        self.assertTrue(xlsx_out.startswith(b"PK\x03\x04"))

        docx_out = survey_docx(res, p_u002)
        self.assertTrue(docx_out.startswith(b"PK\x03\x04"))

    def test_measure_crud_lifecycle(self):
        """Перевірка повного життєвого циклу заходу: створення, редагування, виключення/видалення."""
        c = self.client_for("u-002")

        # 1. Створення нового заходу
        new_data = {
            "section": "R1",
            "content": "Створити новий канал повідомлень",
            "unit": "P01",
            "strok_text": "Постійно",
            "strok_type": "postiino",
            "indicator": "Кількість перевірок",
            "indicator_unit": "шт.",
            "indicator_target": 12,
            "required_evidence": "Звіт",
            "co_units": ["P02"],
        }
        r_create = c.post("/api/measures", new_data, format="json")
        self.assertEqual(r_create.status_code, 201)
        created_code = r_create.json()["code"]

        m = Measure.objects.get(code=created_code)
        self.assertEqual(m.content, "Створити новий канал повідомлень")
        self.assertEqual(m.co_units.count(), 1)
        self.assertTrue(AuditLog.objects.filter(action="створено захід", obj_id=created_code).exists())

        # 2. Редагування заходу (PATCH)
        r_patch = c.patch(
            f"/api/measures/{created_code}",
            {"content": "Оновлений зміст каналу повідомлень", "indicator_target": 15},
            format="json",
        )
        self.assertEqual(r_patch.status_code, 200)
        m.refresh_from_db()
        self.assertEqual(m.content, "Оновлений зміст каналу повідомлень")
        self.assertEqual(m.indicator_target, 15.0)
        self.assertTrue(AuditLog.objects.filter(action="змінено захід", obj_id=created_code).exists())

        # 3. Додавання незмінного підтвердження Evidence до заходу
        ev = Evidence.objects.create(
            code="E-TEST-01",
            measure=m,
            type="наказ",
            title="Тестовий наказ",
            doc_date=date(2026, 1, 1),
            uploaded_at=date(2026, 1, 1),
            sha256="0" * 64,
        )

        # 4. Спроба видалення без підстави -> має повернути 400 з requires_reason
        r_del_fail = c.delete(f"/api/measures/{created_code}")
        self.assertEqual(r_del_fail.status_code, 400)
        self.assertTrue(r_del_fail.json().get("requires_reason"))

        # 5. Виключення заходу з програми з вказанням підстави
        r_exclude = c.delete(
            f"/api/measures/{created_code}",
            {"reason": "Наказ ректора від 18.09.2026 № 214-од"},
            format="json",
        )
        self.assertEqual(r_exclude.status_code, 200)
        self.assertEqual(r_exclude.json()["status"], "excluded")

        m.refresh_from_db()
        self.assertTrue(m.is_excluded)
        self.assertIn("214-од", m.exclusion_reason)
        self.assertTrue(AuditLog.objects.filter(action="виключено захід із програми", obj_id=created_code).exists())

        # 6. Перевірка цілісності ланцюжка SHA-256 після всіх операцій
        self.assertTrue(AuditLog.verify_chain()["ok"])

    def test_analyst_watermark_and_footprint(self):
        """Перевірка персоналізованого сліду для ролі ANAL та його відсутності для інших ролей."""
        c_anal = self.client_for("u-005")
        c_koord = self.client_for("u-002")

        # 1. Експорт звіту аналітиком ANAL містить персоналізований цифровий слід
        r_anal_xlsx = c_anal.get("/api/reports/portal?year=2026&half=1&format=xlsx")
        self.assertEqual(r_anal_xlsx.status_code, 200)
        self.assertIn("X-Digital-Footprint", r_anal_xlsx.headers)
        self.assertTrue(r_anal_xlsx.headers["X-Digital-Footprint"].startswith("ANAL · U-005"))

        r_anal_docx = c_anal.get("/api/reports/portal?year=2026&half=1&format=docx")
        self.assertEqual(r_anal_docx.status_code, 200)
        self.assertIn("X-Digital-Footprint", r_anal_docx.headers)
        self.assertTrue(r_anal_docx.headers["X-Digital-Footprint"].startswith("ANAL · U-005"))

        # Перевірка наявності колонтитула в самому Word-документі аналітика
        import io
        from docx import Document
        doc = Document(io.BytesIO(r_anal_docx.content))
        foot_texts = [p.text for s in doc.sections for p in s.footer.paragraphs]
        self.assertTrue(any("ANAL · U-005" in t for t in foot_texts))

        # 2. Експорт уповноваженим KOORD НЕ містить цифрового сліду ANAL
        r_koord_xlsx = c_koord.get("/api/reports/portal?year=2026&half=1&format=xlsx")
        self.assertEqual(r_koord_xlsx.status_code, 200)
        self.assertNotIn("X-Digital-Footprint", r_koord_xlsx.headers)

    def test_unit_management_and_audit_trail(self):
        c_koord = self.client_for("u-002")
        c_admin = self.client_for("u-001")
        c_vyk = self.client_for("u-006")
        c_ker = self.client_for("u-004")

        # 1. Виконавець та керівник не мають права створювати підрозділи
        self.assertEqual(c_vyk.post("/api/units", {"code": "P98", "name": "Тест"}, format="json").status_code, 403)
        self.assertEqual(c_ker.post("/api/units", {"code": "P98", "name": "Тест"}, format="json").status_code, 403)

        # 2. Уповноважений створює новий підрозділ
        r_create = c_koord.post("/api/units", {
            "code": "P99", "name": "Науково-дослідна лабораторія", "type": "НДЛ", "note": "Створено уповноваженим"
        }, format="json")
        self.assertEqual(r_create.status_code, 201)
        self.assertEqual(r_create.json()["code"], "P99")

        # 3. Адміністратор редагує підрозділ
        r_patch = c_admin.patch("/api/units/P99", {
            "name": "Оновлена науково-дослідна лабораторія", "type": "Лабораторія"
        }, format="json")
        self.assertEqual(r_patch.status_code, 200)
        self.assertEqual(r_patch.json()["name"], "Оновлена науково-дослідна лабораторія")

        # 4. Перевірка незмінного криптографічного ланцюжка SHA-256
        chain = AuditLog.verify_chain()
        self.assertTrue(chain["ok"], f"Порушено цілісність ланцюжка: {chain}")
        self.assertTrue(AuditLog.objects.filter(obj_type="pidrozdil", obj_id="P99").exists())

    def test_execution_description_and_public_measures(self):
        c_admin = self.client_for("u-001")
        c_koord = self.client_for("u-002")
        anon = APIClient()

        # 1. Адміністратор та уповноважений можуть вносити розгорнутий опис виконання
        r_exec = c_admin.post("/api/measures/Z-01/execution", {
            "period": "2026-Q2",
            "status": "v_roboti",
            "result_text": "Проведено робочу зустріч щодо оптимізації процесів, розроблено проект наказу.",
        }, format="json")
        self.assertEqual(r_exec.status_code, 200)

        # Перевірка отримання в картці заходу
        r_m = c_koord.get("/api/measures/Z-01?period=2026-Q2")
        self.assertEqual(r_m.status_code, 200)
        self.assertIn("Проведено робочу зустріч", r_m.json()["result_text"])

        # 2. Публічний реєстр для громадськості (/api/public/measures) при відкритому доступі
        pr = Program.objects.first()
        orig_restr = pr.restricted_info
        pr.restricted_info = False
        pr.save()
        try:
            r_pub = anon.get("/api/public/measures?period=2026-Q2")
            self.assertEqual(r_pub.status_code, 200)
            data = r_pub.json()
            self.assertFalse(data["restricted"])
            self.assertTrue(len(data["items"]) > 0)
            m_z01 = next((item for item in data["items"] if item["code"] == "Z-01"), None)
            self.assertIsNotNone(m_z01)
            self.assertIn("Проведено робочу зустріч", m_z01["result_text"])
            self.assertIn("monitoring", data)
            self.assertIn("on_time_of_dated_done", data["monitoring"]["percent"])

            # 3. При увімкненні режиму ІзОД / ДСК публічний реєстр обмежує деталізований вміст
            pr.restricted_info = True
            pr.save()
            r_restr = anon.get("/api/public/measures?period=2026-Q2")
            self.assertEqual(r_restr.status_code, 200)
            self.assertTrue(r_restr.json()["restricted"])
            self.assertEqual(len(r_restr.json()["items"]), 0)
        finally:
            pr.restricted_info = orig_restr
            pr.save()




