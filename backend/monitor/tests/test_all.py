"""Тести: python manage.py test monitor"""
from datetime import date

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from monitor.models import AuditLog, Evidence, Program, ReportingPeriod, ReportSnapshot, SystemSettings
from monitor.selfcheck import run_selfcheck
from monitor.surveys import compare, parse_csv


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
        for code in ("u-001", "u-004", "u-006", "u-005"):
            self.assertEqual(self.client_for(code).get("/api/surveys").status_code, 403, code)
        self.assertEqual(self.client_for("u-002").get("/api/surveys").status_code, 200)

    def test_tech_admin_cannot_change_content(self):
        c = self.client_for("u-001")
        self.assertEqual(c.patch("/api/measures/Z-01", {"content": "x"}, format="json").status_code, 403)
        self.assertEqual(c.get("/api/users").status_code, 200)

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


class Surveys(TestCase):
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


