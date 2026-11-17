"""Формує Word-версії документів для подання (docs/*.md → docs/word/*.docx) за ДСТУ 4163:2020.

    python manage.py build_docs
"""
from pathlib import Path

from django.conf import settings
from django.core.management import BaseCommand

from monitor import docgen as D

DOCS = Path(settings.BASE_DIR).parent / "docs"
ORDER = [
    ("architecture.md", "01_Arkhitektura.docx"),
    ("time-savings.md", "02_Ekonomiia_chasu.docx"),
    ("integration.md", "03_Karta_intehratsii.docx"),
    ("abuse-analysis.md", "04_Analiz_zlovzhyvan.docx"),
    ("ai-note.md", "05_Yak_my_vykorystaly_SHI.docx"),
    ("demo-script.md", "06_Stsenarii_demo.docx"),
]


class Command(BaseCommand):
    help = "Word-версії документів команди за ДСТУ 4163:2020"

    def handle(self, *args, **kw):
        out = DOCS / "word"
        out.mkdir(exist_ok=True)
        for src, dst in ORDER:
            md = (DOCS / src).read_text(encoding="utf-8")
            doc = D.new_document(landscape=src in ("integration.md", "abuse-analysis.md", "demo-script.md"))
            D.para(doc, "АКП-МОНІТОР", indent=False, align="center", bold=True)
            D.para(doc, "Цифрова система моніторингу виконання антикорупційної програми", indent=False, align="center")
            D.para(doc, "IV Хакатон з питань виховання доброчесності та запобігання корупції, Завдання 2", indent=False,
                   align="center", size=12, space_after=12)
            D.markdown_to_docx(md, doc)
            (out / dst).write_bytes(D.to_bytes(doc))
            self.stdout.write(f"{dst}")
