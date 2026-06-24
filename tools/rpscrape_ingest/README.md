# rpscrape_ingest

Pipeline Python independente que **enriquece o histórico de corridas** no Supabase com dados que Racing API / HR / SPB não trazem: comments-in-running, RPR, Topspeed, ovr_btn, secs, Betfair SP.

Não substitui as fontes atuais; **complementa** o histórico que vira input pras features de pace (Tier 1 #3 do roadmap).

## Arquitetura

```
[ rpscrape (Python, terceiro) ]
   │
   ├─ ./rpscrape.py -d DATE -r REGION -t TYPE
   ▼
[ CSV em data/region/<region>/<type>/<file>.csv ]
   │
   ├─ ingest_csv.py
   ▼
[ hml.rpscrape_results no Supabase ]
   │   (match_status='pending')
   ├─ match_to_race_horses.py
   ▼
[ hml.rpscrape_results com race_horse_id resolvido ]
        ↓
[ Pipeline Node lê via JOIN nas queries de feature ]
```

**Componentes**:
- `sql/001_create_rpscrape_results.sql` — DDL da tabela
- `lib/parsers.py` — parsers de campos CSV + normalização de nome de cavalo
- `ingest_csv.py` — carrega CSV(s) → `hml.rpscrape_results` (UPSERT por chave natural)
- `match_to_race_horses.py` — resolve `race_horse_id` via join com `race_horses_hr_enriched`
- `run_daily.sh` — cron diário (D-1 GB+IRE flat+jumps)
- `run_backfill.sh` — backfill one-shot por janela de anos

## Setup no mazeserver (one-shot)

### 1. Python 3.13+

Não está instalado por default. Instala via pyenv pra não bagunçar system Python:

```bash
sudo apt update && sudo apt install -y build-essential libssl-dev zlib1g-dev \
  libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev
curl https://pyenv.run | bash
# adicionar pyenv ao ~/.bashrc conforme prompt do instalador
exec $SHELL
pyenv install 3.13.0
pyenv global 3.13.0
python3 --version  # confirma 3.13+
```

### 2. rpscrape

```bash
sudo mkdir -p /opt/rpscrape && sudo chown $USER /opt/rpscrape
git clone https://github.com/joenano/rpscrape.git /opt/rpscrape
cd /opt/rpscrape
python3 -m venv venv
./venv/bin/pip install curl_cffi jarowinkler lxml orjson python-dotenv tomli tqdm

# .env com credenciais da conta Racing Post de serviço:
#   EMAIL=<email da conta>
#   REFRESH_TOKEN=<JWE do cookie .refreshToken — dura ~30 dias>
#   ACCESS_TOKEN=<JWT do cookie .accessToken — refresh_token.py renova >
nano /opt/rpscrape/.env
chmod 600 /opt/rpscrape/.env

# Ativar campos extras: ts (Topspeed) + Betfair data
cp settings/default_settings.toml settings/user_settings.toml
sed -i 's/^ts = false/ts = true/' settings/user_settings.toml
sed -i 's/^betfair_data = false/betfair_data = true/' settings/user_settings.toml
```

### 3. Tabela no Supabase

```bash
# Do mazeserver, conexão local ao container do Postgres do Supabase
docker exec -i supabase-db psql -U postgres -d postgres \
  < /opt/horsingmaze/tools/rpscrape_ingest/sql/001_create_rpscrape_results.sql
```

### 4. Ingestor Python

```bash
sudo mkdir -p /opt/horsingmaze && sudo chown $USER /opt/horsingmaze
git clone <repo> /opt/horsingmaze
cd /opt/horsingmaze/tools/rpscrape_ingest
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

cat > .env <<EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=<from supabase-db env>
EOF
chmod 600 .env
```

### 5. Smoke test (1 dia)

```bash
cd /opt/rpscrape/scripts
./venv/bin/python rpscrape.py -d 2024/06/01 -r gb -t flat
# espera CSV em /opt/rpscrape/data/region/gb/flat/2024_06_01.csv

# ingere
cd /opt/horsingmaze/tools/rpscrape_ingest
./venv/bin/python ingest_csv.py /opt/rpscrape/data/region/gb/flat/2024_06_01.csv

# resolve matching
./venv/bin/python match_to_race_horses.py --since 2024-06-01 --limit 5000

# inspeção
docker exec -it supabase-db psql -U postgres -d postgres -c \
  "SELECT match_status, COUNT(*) FROM hml.rpscrape_results GROUP BY 1"
```

Match rate alvo: ≥90%. Abaixo disso, investigar query de matching antes de fazer backfill grande.

### 6. Cron diário

```bash
sudo mkdir -p /var/log/rpscrape && sudo chown $USER /var/log/rpscrape
crontab -e
# adicionar:
# 0 20 * * * /opt/horsingmaze/tools/rpscrape_ingest/run_daily.sh
```

### 7. Backfill

Em screen/tmux porque demora horas a dias:

```bash
screen -S backfill
/opt/horsingmaze/tools/rpscrape_ingest/run_backfill.sh 2020 2025
# Ctrl-A D pra desanexar
```

## Troubleshooting

**rpscrape retorna 401/forbidden**
- Token cognito expirou. Acesse racingpost.com no browser, abre DevTools → Cookies → procura `CognitoIdentityServiceProvider.*.accessToken`, atualiza `/opt/rpscrape/.env`.

**Match rate muito baixo (< 70%)**
- `course` diverge entre fontes ("Newmarket" vs "Newmarket (July)"). Adicionar normalização em SQL no `match_to_race_horses.py`.
- `off_time` formato diferente. A query já tenta fallback "name-unique" — checar se está sendo usado via `match_confidence`.

**Backfill travou no meio**
- rpscrape escreve por arquivo (year/region/type). Se um falhou, re-rodar só esse: `./rpscrape.py -y 2022 -r ire -t jumps`.
- Ingestor é idempotente (ON CONFLICT DO NOTHING).

**Disco enchendo no servidor**
- CSVs do rpscrape ficam em `/opt/rpscrape/data/region/...`. Pode gzipar (`gzip_output = true` em user_settings.toml) ou rotacionar pra S3 depois de ingerir.

## O que o pipeline Node consome

Após match, queries do orchestrator (`historical.features.ts`) podem fazer JOIN tipo:

```sql
SELECT
  rh.id AS race_horse_id,
  rps.comment,
  rps.ovr_btn,
  rps.secs,
  rps.rpr_rating,
  rps.ts_rating
FROM hml.race_horses_hr_enriched rh
LEFT JOIN hml.rpscrape_results rps ON rps.race_horse_id = rh.id
WHERE rh.id_horse = $1
  AND rh.id IN (... histórico do cavalo)
```

`LEFT JOIN` porque match nunca será 100% — corrida sem cobertura no rpscrape volta NULL e a feature decai pro fallback (form string + position).
