"""Тести: python manage.py test monitor"""
from datetime import date

from django.core.cache import cache
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

    def setUp(self):
        super().setUp()
        cache.clear()

    def client_for(self, code):
        c = APIClient()
        from monitor.key_crypto import get_or_create_test_key_container, sign_challenge_with_key_container
        r_chal = c.post("/api/auth/challenge", {"login": code}, format="json")
        self.assertEqual(r_chal.status_code, 200, r_chal.content)
        chal_data = r_chal.json()

        kf = get_or_create_test_key_container(code.lower())
        sig = sign_challenge_with_key_container(kf, "demo", chal_data["challenge"])

        r_auth = c.post("/api/auth/login-key", {
            "login": code,
            "challenge_id": chal_data["challenge_id"],
            "signature": sig,
        }, format="json")
        self.assertEqual(r_auth.status_code, 200, r_auth.content)
        c.credentials(HTTP_AUTHORIZATION="Token " + r_auth.json()["token"])
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

        # 2. /api/public/overview також видає csrftoken та довідник розділів
        r_ov = anon.get("/api/public/overview")
        self.assertEqual(r_ov.status_code, 200)
        self.assertIn("csrfToken", r_ov.json())
        self.assertIn("sections", r_ov.json())

        # 3. Вхід за ключем із передачею X-CSRFToken
        from monitor.key_crypto import get_or_create_test_key_container, sign_challenge_with_key_container
        r_chal = anon.post("/api/auth/challenge", {"login": "u-002"}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r_chal.status_code, 200, r_chal.content)
        chal_data = r_chal.json()
        kf = get_or_create_test_key_container("u-002")
        sig = sign_challenge_with_key_container(kf, "demo", chal_data["challenge"])

        r_login = anon.post("/api/auth/login-key", {
            "login": "u-002",
            "challenge_id": chal_data["challenge_id"],
            "signature": sig,
        }, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r_login.status_code, 200, r_login.content)
        self.assertIn("token", r_login.json())

        # 4. Захист від Replay-атаки: повторне надсилання того самого challenge_id повертає 400
        r_replay = anon.post("/api/auth/login-key", {
            "login": "u-002",
            "challenge_id": chal_data["challenge_id"],
            "signature": sig,
        }, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r_replay.status_code, 400)

        # 5. Спроба класичного входу лише за паролем заблокована (HTTP 400)
        r_legacy = anon.post("/api/auth/login", {"username": "u-002", "password": "demo"}, format="json")
        self.assertEqual(r_legacy.status_code, 400)
        self.assertIn("Класичний вхід", r_legacy.json()["detail"])

    def test_logout_revokes_token_and_login_rate_limit(self):
        from django.core.cache import cache
        cache.clear()
        c = self.client_for("u-005")
        self.assertEqual(c.get("/api/auth/me").status_code, 200)
        self.assertEqual(c.post("/api/auth/logout").status_code, 204)
        self.assertEqual(c.get("/api/auth/me").status_code, 401)

        anon = APIClient()
        for _ in range(10):
            r = anon.post("/api/auth/challenge", {"login": "rate_user_test"}, format="json")
            self.assertEqual(r.status_code, 400)
        r_blocked = anon.post("/api/auth/challenge", {"login": "rate_user_test"}, format="json")
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


class OwaspSecurityTests(Base):
    def test_login_rate_limiting_and_enumeration(self):
        client = APIClient()
        cache.clear()
        # 1. Неіснуючий логін повертає 400
        r1 = client.post("/api/auth/challenge", {"login": "nonexistent_user"}, format="json")
        self.assertEqual(r1.status_code, 400)
        self.assertEqual(r1.json()["detail"], "Користувача не знайдено або відсутній активний ключ доступу.")

        # 2. Rate limiting: не більше 10 спроб на хвилину
        for _ in range(10):
            client.post("/api/auth/challenge", {"login": "rate_test_user"}, format="json")
        r_throttle = client.post("/api/auth/challenge", {"login": "rate_test_user"}, format="json")
        self.assertEqual(r_throttle.status_code, 429)
        self.assertEqual(r_throttle.json()["detail"], "Забагато спроб входу. Спробуйте пізніше.")
        cache.clear()

    def test_audit_chain_repair_command(self):
        # Перевірка команди відновлення ланцюжка
        res = AuditLog.verify_chain()
        self.assertTrue(res["ok"])
        call_command("repair_audit_chain", "--fix")
        res2 = AuditLog.verify_chain()
        self.assertTrue(res2["ok"])

    def test_evidence_duplicate_detection(self):
        c_koord = self.client_for("u-002")
        from django.core.files.uploadedfile import SimpleUploadedFile
        f1 = SimpleUploadedFile("report_doc.pdf", b"%PDF-1.4 test document content for duplicate check", content_type="application/pdf")
        r1 = c_koord.post("/api/measures/Z-01/evidence", {
            "title": "Звітний документ 1",
            "doc_date": "2026-03-15",
            "type": "звіт",
            "file": f1,
            "period": "2026-Q1"
        }, format="multipart")
        self.assertEqual(r1.status_code, 201)
        self.assertNotIn("duplicate_warning", r1.json())

        # Завантажуємо ТОЙ САМИЙ файл до іншого заходу (Z-02)
        f2 = SimpleUploadedFile("report_doc.pdf", b"%PDF-1.4 test document content for duplicate check", content_type="application/pdf")
        r2 = c_koord.post("/api/measures/Z-02/evidence", {
            "title": "Звітний документ 2 (дублікат)",
            "doc_date": "2026-03-15",
            "type": "звіт",
            "file": f2,
            "period": "2026-Q1"
        }, format="multipart")
        self.assertEqual(r2.status_code, 201)
        self.assertIn("duplicate_warning", r2.json())
        self.assertTrue(r2.json()["is_duplicate"])
        self.assertTrue(any(d["measure"] == "Z-01" for d in r2.json()["duplicate_in"]))

    def test_evidence_whitelist_and_magic_bytes_validation(self):
        """Сувора перевірка білого списку розширень, блокування макросів та валідація magic bytes."""
        import io
        import zipfile
        from django.core.files.uploadedfile import SimpleUploadedFile
        c = self.client_for("u-002")

        # 1. Явно заборонені типи: .exe, .sh, .js, .svg, .html
        for ext, content, mime in [
            (".exe", b"MZ\x90\x00executable", "application/x-msdownload"),
            (".sh", b"#!/bin/bash\nrm -rf /", "application/x-sh"),
            (".js", b"alert(1)", "application/javascript"),
            (".svg", b"<svg><script>alert(1)</script></svg>", "image/svg+xml"),
            (".html", b"<html>evil</html>", "text/html"),
            (".docm", b"PK\x03\x04fake docm", "application/vnd.ms-word.document.macroEnabled.12"),
            (".xlsm", b"PK\x03\x04fake xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"),
            (".pptm", b"PK\x03\x04fake pptm", "application/vnd.ms-powerpoint.presentation.macroEnabled.12"),
        ]:
            f = SimpleUploadedFile(f"file{ext}", content, content_type=mime)
            r = c.post("/api/measures/Z-01/evidence", {
                "title": f"Test {ext}", "doc_date": "2026-06-01", "file": f
            }, format="multipart")
            self.assertEqual(r.status_code, 400, f"Expected 400 for {ext}")

        # 2. Фейковий PDF (невірні magic bytes)
        fake_pdf = SimpleUploadedFile("fake.pdf", b"NOT_A_PDF_HEADER_CONTENT", content_type="application/pdf")
        r_pdf = c.post("/api/measures/Z-01/evidence", {
            "title": "Fake PDF", "doc_date": "2026-06-01", "file": fake_pdf
        }, format="multipart")
        self.assertEqual(r_pdf.status_code, 400)
        self.assertIn("PDF", r_pdf.content.decode("utf-8"))

        # 3. Фейковий DOCX (не ZIP)
        fake_docx = SimpleUploadedFile("fake.docx", b"NOT_A_ZIP_CONTAINER", content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        r_docx = c.post("/api/measures/Z-01/evidence", {
            "title": "Fake DOCX", "doc_date": "2026-06-01", "file": fake_docx
        }, format="multipart")
        self.assertEqual(r_docx.status_code, 400)

        # 4. DOCX з макросом (vbaProject.bin) всередині
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", b"<Types/>")
            zf.writestr("word/document.xml", b"<w:document/>")
            zf.writestr("word/vbaProject.bin", b"evil macro content")
        macro_docx = SimpleUploadedFile("macro.docx", buf.getvalue(), content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        r_macro = c.post("/api/measures/Z-01/evidence", {
            "title": "Macro DOCX", "doc_date": "2026-06-01", "file": macro_docx
        }, format="multipart")
        self.assertEqual(r_macro.status_code, 400)
        self.assertIn("макроси", r_macro.content.decode("utf-8"))

        # 5. Валідний PNG файл
        valid_png = SimpleUploadedFile("valid.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRtest", content_type="image/png")
        r_png = c.post("/api/measures/Z-01/evidence", {
            "title": "Valid PNG", "doc_date": "2026-06-01", "file": valid_png
        }, format="multipart")
        self.assertEqual(r_png.status_code, 201)

        # 6. Валідний DOCX файл
        buf_valid = io.BytesIO()
        with zipfile.ZipFile(buf_valid, "w") as zf:
            zf.writestr("[Content_Types].xml", b"<Types/>")
            zf.writestr("word/document.xml", b"<w:document/>")
        valid_docx = SimpleUploadedFile("valid.docx", buf_valid.getvalue(), content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        r_valid_docx = c.post("/api/measures/Z-01/evidence", {
            "title": "Valid DOCX", "doc_date": "2026-06-01", "file": valid_docx
        }, format="multipart")
        self.assertEqual(r_valid_docx.status_code, 201)

    def test_formula_injection_neutralization(self):
        """Захист від CSV/XLSX Formula Injection (OWASP CWE-1236)."""
        from monitor.views import _sanitize_export_cell
        from monitor.surveys import _sanitize_cell

        # 1. Небезпечні формульні префікси екрануються
        for dangerous in ["=cmd|'/C calc'!A0", "+cmd", "-2+5*cmd", "@SUM(A1:A10)", "\t=1+1", "\r+calc", "  =calc"]:
            san = _sanitize_export_cell(dangerous)
            self.assertTrue(san.startswith("'"), f"Expected {dangerous} to be escaped, got {san}")
            san_survey = _sanitize_cell(dangerous)
            self.assertTrue(san_survey.startswith("'"), f"Expected {dangerous} in survey to be escaped, got {san_survey}")

        # 2. Звичайні числа та номери телефонів залишаються без змін
        for safe in ["+380501234567", "-5", "+10", "42", "123.45", "-0.5"]:
            self.assertEqual(_sanitize_export_cell(safe), safe)
            self.assertEqual(_sanitize_cell(safe), safe)

    def test_login_log_injection_sanitization(self):
        """Захист від Log Injection при невдалих входах: очищення переносів рядків та спецсимволів."""
        client = APIClient()
        cache.clear()
        malicious_user = "admin\r\n[AUDIT] fake_admin injected successful login\x00\x1b"
        r = client.post("/api/auth/challenge", {"login": malicious_user}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"], "Користувача не знайдено або відсутній активний ключ доступу.")

        last_log = AuditLog.objects.filter(action__contains="невдала спроба").order_by("-id").first()
        self.assertIsNotNone(last_log)
        self.assertNotIn("\r", last_log.obj_id)
        self.assertNotIn("\n", last_log.obj_id)
        self.assertNotIn("\x00", last_log.obj_id)


    def test_evidence_max_size_limit_20mb(self):
        """Перевірка жорсткого обмеження розміру файлу Evidence (20 МБ)."""
        from django.core.files.uploadedfile import SimpleUploadedFile
        c = self.client_for("u-002")

        # Файл розміром 20 МБ + 1 КБ
        oversized = SimpleUploadedFile(
            "large_doc.pdf",
            b"%PDF-1.4 " + b"0" * (20 * 1024 * 1024 + 1024),
            content_type="application/pdf"
        )
        r = c.post("/api/measures/Z-01/evidence", {
            "title": "Завеликий файл", "doc_date": "2026-06-01", "file": oversized
        }, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("file"), "Розмір файлу не повинен перевищувати 20 МБ.")

    def test_unified_error_handler_no_stacktrace(self):
        """Уніфікований JSON-обробник помилок 400/403/404/500 без витоку стектрейсів."""
        from monitor.views import custom_400, custom_403, custom_404, custom_500, custom_exception_handler
        from django.test import RequestFactory
        import json

        rf = RequestFactory()
        req = rf.get("/api/unknown/endpoint")

        r400 = custom_400(req)
        self.assertEqual(r400.status_code, 400)
        self.assertEqual(json.loads(r400.content)["detail"], "Некоректний запит.")

        r403 = custom_403(req)
        self.assertEqual(r403.status_code, 403)
        self.assertEqual(json.loads(r403.content)["detail"], "Доступ заборонено.")

        r404 = custom_404(req)
        self.assertEqual(r404.status_code, 404)
        self.assertEqual(json.loads(r404.content)["detail"], "Запитуваний ресурс не знайдено.")

        r500 = custom_500(req)
        self.assertEqual(r500.status_code, 500)
        self.assertEqual(json.loads(r500.content)["detail"], "Внутрішня помилка сервера. Спробуйте пізніше.")
        self.assertNotIn("Traceback", r500.content.decode("utf-8"))

        # Тест custom_exception_handler для неочікуваного RuntimeError
        drf_resp = custom_exception_handler(RuntimeError("Секретна помилка бази даних"), {"request": req})
        self.assertEqual(drf_resp.status_code, 500)
        self.assertEqual(json.loads(drf_resp.content)["detail"], "Внутрішня помилка сервера. Спробуйте пізніше.")
        self.assertNotIn("Секретна помилка", drf_resp.content.decode("utf-8"))

    def test_key_file_crypto_and_admin_key_management(self):
        """Перевірка протоколу Challenge-Response, управління ключами та захисту від атак."""
        admin_c = self.client_for("u-001")

        # 1. Список ключів у тех-адмінці
        r_list = admin_c.get("/api/admin/keys")
        self.assertEqual(r_list.status_code, 200)
        keys_data = r_list.json()
        self.assertGreater(len(keys_data), 0)
        u2 = next(x for x in keys_data if x["code"] == "U-002")
        self.assertEqual(u2["status"], "active")
        self.assertTrue(bool(u2["fingerprint"]))

        # 2. Відкликання ключа користувача
        r_rev = admin_c.post("/api/admin/keys/U-002/revoke")
        self.assertEqual(r_rev.status_code, 200)

        # 3. Вхід для користувача з відкликаним ключем неможливий
        anon = APIClient()
        r_chal = anon.post("/api/auth/challenge", {"login": "u-002"}, format="json")
        self.assertEqual(r_chal.status_code, 400)
        self.assertEqual(r_chal.json()["detail"], "Користувача не знайдено або відсутній активний ключ доступу.")

        # 4. Випуск нового ключа через API (реєстрація публічного ключа)
        from monitor.key_crypto import generate_key_file, sign_challenge_with_key_container
        new_kf = generate_key_file("u-002", "KOORD", "super_secret_pw_123")
        r_reg = admin_c.post("/api/admin/keys/register", {
            "user_code": "U-002",
            "public_key_pem": new_kf["crypto"]["public_key"],
            "fingerprint": new_kf["fingerprint"],
        }, format="json")
        self.assertEqual(r_reg.status_code, 201)
        self.assertEqual(r_reg.json()["fingerprint"], new_kf["fingerprint"])

        # 5. Успішний вхід за новим ключем
        r_chal2 = anon.post("/api/auth/challenge", {"login": "u-002"}, format="json")
        self.assertEqual(r_chal2.status_code, 200)
        sig = sign_challenge_with_key_container(new_kf, "super_secret_pw_123", r_chal2.json()["challenge"])
        r_auth = anon.post("/api/auth/login-key", {
            "login": "u-002",
            "challenge_id": r_chal2.json()["challenge_id"],
            "signature": sig,
        }, format="json")
        self.assertEqual(r_auth.status_code, 200)
        self.assertIn("token", r_auth.json())

        # 6. Перевірка команди generate_local_keys
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp_dir:
            call_command("generate_local_keys", "--password", "test_pw", "--output", tmp_dir, "--user", "u-001")
            key_files = list(Path(tmp_dir).glob("*.key"))
            self.assertEqual(len(key_files), 1)
            self.assertTrue(key_files[0].name.startswith("akp_u-001"))

    def test_two_level_progress_and_rules_version(self):
        """Перевірка дворівневого моніторингу та фіксації rules_version."""
        c = self.client_for("u-002")
        r = c.get("/api/dashboard")
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d.get("rules_version"), "v1.2.0")
        mon = d.get("monitoring", {})
        self.assertEqual(mon.get("rules_version"), "v1.2.0")
        self.assertIn("two_level_progress", mon)
        two = mon["two_level_progress"]
        self.assertIn("formal_execution_percent", two)
        self.assertIn("risk_achievement_percent", two)
        self.assertIn("gap", two)
        self.assertEqual(two.get("rules_version"), "v1.2.0")

    def test_measure_done_validation_requires_indicator_fact(self):
        """Заборона ставити статус «Виконано» без фактичного значення індикатора результативності."""
        c = self.client_for("u-001")
        # 1. Спроба зберегти статус «vykonano» без indicator_fact
        r = c.post("/api/measures/Z-01/execution", {
            "period": "2026-Q2",
            "status": "vykonano",
            "fact_date": "2026-06-01",
            "indicator_fact": None,
            "result_text": "Тестовий результат",
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("indicator_fact", r.json())
        self.assertIn("обов'язково заповніть фактичне значення індикатора", r.json()["indicator_fact"])

        # 2. Успішне збереження зі значенням індикатора
        r_ok = c.post("/api/measures/Z-01/execution", {
            "period": "2026-Q2",
            "status": "vykonano",
            "fact_date": "2026-06-01",
            "indicator_fact": 1.0,
            "result_text": "Захід повністю виконано за фактом",
        }, format="json")
        self.assertEqual(r_ok.status_code, 200)

    def test_approval_formal_close_requires_justification(self):
        """Обов'язкове обґрунтування при погодженні заходу попри сигнал «формального закриття» (RF3)."""
        c_koord = self.client_for("u-002")
        # 1. Погодження заходу Z-16 (де активний сигнал RF3) без належного обґрунтування блокується
        r_fail = c_koord.post("/api/measures/Z-16/approve", {
            "period": "2026-Q2",
            "decision": "approve",
            "formal_close_justification": "Коротко",
        }, format="json")
        self.assertEqual(r_fail.status_code, 400)
        self.assertIn("formal_close_justification", r_fail.json())

        # 2. Погодження з обґрунтуванням >= 20 символів проходить успішно
        valid_just = "Захід перевірено за внутрішніми реєстрами наказом № 102/2026 у повному обсязі."
        r_ok = c_koord.post("/api/measures/Z-16/approve", {
            "period": "2026-Q2",
            "decision": "approve",
            "formal_close_justification": valid_just,
        }, format="json")
        self.assertEqual(r_ok.status_code, 200)
        from monitor.models import Execution
        ex = Execution.objects.get(measure__code="Z-16", period__code="2026-Q2")
        self.assertEqual(ex.formal_close_justification, valid_just)

    def test_key_revoke_flushes_sessions_and_tokens(self):
        """Миттєве завершення активних сесій та токенів при відкликанні ключа."""
        from django.contrib.auth.models import User
        from monitor.models import Profile
        from rest_framework.authtoken.models import Token
        user = User.objects.get(username="u-003")
        token, _ = Token.objects.get_or_create(user=user)

        c_user = APIClient()
        c_user.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        r_me = c_user.get("/api/auth/me")
        self.assertEqual(r_me.status_code, 200)

        # Відкликаємо ключ через адміна
        admin_c = self.client_for("u-001")
        r_rev = admin_c.post("/api/admin/keys/U-003/revoke")
        self.assertEqual(r_rev.status_code, 200)

        # Переконуємось, що токен видалено і наступний запит повертає 401
        self.assertFalse(Token.objects.filter(user=user).exists())
        r_after = c_user.get("/api/auth/me")
        self.assertEqual(r_after.status_code, 401)







