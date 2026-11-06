"""Fetch public, synthetic reference epochs. No application or personal data is sent."""
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DESTINATION = Path('artifacts/your-pattern/qualification/horizons')
DATES = [f'{year}-01-01T00:00:00.000Z' for year in
         [1900, 1910, 1925, 1950, 1962, 1970, 1990, 2000, 2010, 2020, 2026, 2050, 2100]]
BODIES = {'sun': 10, 'moon': 301, 'mercury': 199, 'venus': 299, 'mars': 499,
          'jupiter': 599, 'saturn': 699, 'uranus': 799, 'neptune': 899, 'pluto': 999}

DESTINATION.mkdir(parents=True, exist_ok=True)
for body, target in BODIES.items():
    params = dict(format='json', COMMAND=f"'{target}'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'",
                  EPHEM_TYPE="'OBSERVER'", CENTER="'500@399'", TLIST_TYPE="'JD'",
                  TIME_TYPE="'UT'", QUANTITIES="'31'", CSV_FORMAT="'YES'", ANG_FORMAT="'DEG'",
                  EXTRA_PREC="'YES'", CAL_FORMAT="'BOTH'", CAL_TYPE="'GREGORIAN'", TIME_DIGITS="'FRACSEC'")
    params['TLIST'] = ' '.join(f"'{datetime.fromisoformat(at.replace('Z', '+00:00')).timestamp() / 86400 + 2440587.5}'" for at in DATES)
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=45) as response:
        raw = response.read()
    parsed = json.loads(raw)
    assert '$$SOE' in parsed.get('result', ''), parsed.get('error', 'No reference table')
    # Preserve the exact response bytes; the manifest binds both query and response.
    (DESTINATION / f'{body}.json').write_bytes(raw)
    manifest = dict(body=body, target=target, dates=DATES, url=url,
                    fetchedAt=datetime.now(timezone.utc).isoformat(),
                    responseSha256=hashlib.sha256(raw).hexdigest())
    (DESTINATION / f'{body}.request.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(body, manifest['responseSha256'], flush=True)
