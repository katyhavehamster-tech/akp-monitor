"""Генератор двох демонстраційних CSV у форматі експорту Google Форми.
Усі відповіді вигадані; форма не збирає електронні адреси. python3 make_demo.py"""
import csv, random
from datetime import datetime, timedelta
from pathlib import Path

Q = ["Позначка часу",
     "Ваша категорія",
     "Чи знаєте ви, куди повідомити про можливі корупційні правопорушення?",
     "Оцініть довіру до внутрішніх каналів повідомлення (1 – зовсім не довіряю, 5 – повністю довіряю)",
     "Чи стикалися ви з потенційним конфліктом інтересів за останні 6 місяців?",
     "Наскільки зрозумілі антикорупційні правила у вашому підрозділі? (1–5)",
     "Чи проходили ви антикорупційне навчання цього року?",
     "Які теми антикорупційного навчання для вас найкорисніші?",
     "Ваші пропозиції щодо запобігання корупції"]
CAT = ["Курсант / слухач", "Науково-педагогічний працівник", "Працівник апарату", "Керівник підрозділу"]
TOPICS = ["Конфлікт інтересів", "Подарунки", "Повідомлення про корупцію", "Декларування", "Публічні закупівлі"]
PROP = ["Більше практичних кейсів на заняттях", "Пояснювати, як захищають викривачів", "Коротка памʼятка щодо подарунків",
        "Регулярні нагадування про декларування", "Анонімна скринька в кожному корпусі", "Онлайн-курс з конфлікту інтересів",
        "", "", "", ""]

def wave(n, start, p_know, trust_mu, clear_mu, p_trained, seed):
    rnd = random.Random(seed)
    rows = []
    for i in range(n):
        ts = start + timedelta(minutes=rnd.randint(0, 60 * 24 * 10))
        clamp = lambda x: max(1, min(5, round(x)))
        know = rnd.choices(["Так", "Частково", "Ні"], [p_know, (1 - p_know) * 0.6, (1 - p_know) * 0.4])[0]
        rows.append([ts.strftime("%d.%m.%Y %H:%M:%S"), rnd.choices(CAT, [5, 2, 2, 1])[0], know,
                     clamp(rnd.gauss(trust_mu, 1.0)),
                     rnd.choices(["Так", "Ні", "Важко відповісти"], [1, 6, 2])[0],
                     clamp(rnd.gauss(clear_mu, 0.9)),
                     "Так" if rnd.random() < p_trained else "Ні",
                     ";".join(rnd.sample(TOPICS, rnd.randint(1, 2))),
                     rnd.choice(PROP)])
    return rows

here = Path(__file__).parent
for name, args in [("opytuvannia_khvylia_1_2026-03.csv", (64, datetime(2026, 3, 16), 0.55, 2.9, 3.1, 0.35, 1)),
                   ("opytuvannia_khvylia_2_2026-06.csv", (71, datetime(2026, 6, 15), 0.72, 3.4, 3.7, 0.68, 2))]:
    with open(here / name, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(Q)
        w.writerows(wave(*args))
    print(name)
