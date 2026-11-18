from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="systemsettings",
            name="signatory_name",
            field=models.CharField(
                blank=True,
                default="Олександр КОВАЛЕНКО",
                max_length=200,
                verbose_name="Власне імʼя ПРІЗВИЩЕ уповноваженої особи (для Word-звітів)",
            ),
        ),
        migrations.AddField(
            model_name="systemsettings",
            name="head_signatory_name",
            field=models.CharField(
                blank=True,
                default="Валерій СОКОЛОВ",
                max_length=200,
                verbose_name="Власне імʼя ПРІЗВИЩЕ керівника органу (для Word-звітів)",
            ),
        ),
    ]
