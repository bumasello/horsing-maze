#!/usr/bin/env python3
"""Puxa resultados do Sporting Life com dividendos do TOTE (win/place/exacta) para
uma janela de dias. Saída: JSONL, uma linha por corrida. Roda no bspnode."""
import json, sys, time, urllib.request, datetime, os
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
API = "https://www.sportinglife.com/api/horse-racing"
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 120
OUT = os.path.expanduser("~/tote_data/sl_tote.jsonl")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
done = set()
if os.path.exists(OUT):
    for line in open(OUT):
        try: done.add(json.loads(line)["race_id"])
        except Exception: pass

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            time.sleep(2 * (i + 1))
    return None

today = datetime.date.today()
n_ok = 0
with open(OUT, "a") as fh:
    for d in range(1, DAYS + 1):
        day = (today - datetime.timedelta(days=d)).isoformat()
        cards = get(f"{API}/racing/racecards/{day}") or []
        for meeting in cards:
            for race in meeting.get("races", []):
                rid = (race.get("race_summary_reference") or {}).get("id")
                if not rid or rid in done:
                    continue
                det = get(f"{API}/race/{rid}")
                if not det:
                    continue
                rs = det.get("race_summary") or {}
                rides = []
                for r in det.get("rides", []):
                    h = r.get("horse") or {}
                    rides.append({"name": h.get("name"), "pos": r.get("finish_position"),
                                  "sp": (r.get("betting") or {}).get("current_odds"),
                                  "num": r.get("cloth_number")})
                fh.write(json.dumps({
                    "race_id": rid, "date": day, "course": rs.get("course_name") or race.get("course_name"),
                    "time": rs.get("time") or race.get("time"), "name": rs.get("name") or race.get("name"),
                    "ride_count": race.get("ride_count"),
                    "tote_win": det.get("tote_win"), "place_win": det.get("place_win"),
                    "exacta_win": det.get("exacta_win"), "trifecta": det.get("trifecta"),
                    "straight_forecast": det.get("straight_forecast"),
                    "n_placed": det.get("number_of_placed_rides"), "rides": rides,
                }) + "\n"); fh.flush()
                n_ok += 1
                time.sleep(0.4)
        print(f"{day}: acumulado {n_ok} corridas", flush=True)
print("FIM", n_ok)
