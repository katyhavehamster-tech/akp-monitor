from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0009_useraccesskey"),
    ]

    operations = [
        migrations.AddField(
            model_name="execution",
            name="formal_close_justification",
            field=models.TextField(blank=True, default="", verbose_name="Обґрунтування погодження попри сигнал формального закриття"),
        ),
        migrations.AddField(
            model_name="reportsnapshot",
            name="rules_version",
            field=models.CharField(default="v1.2.0", max_length=20, verbose_name="Версія набору правил"),
        ),
    ]
