# HCP territory map (demo)

Interactive Leaflet map of HCP locations, territories and a rebalanced 6-territory scenario, with call-potential numbers per territory and brick.

**All HCP data is anonymised**: names, IDs, street addresses and product names are dummy values, and locations are random points inside the same postcode area. PLZ, city, specialty, priorities and all call numbers are unchanged.

Access: the page asks for a user and password. This is a client-side gate only (it keeps casual visitors out; the data files are still publicly reachable), so it is not a security boundary.

Run locally: `./serve.sh`, then open http://localhost:8000/. Basemap: OpenStreetMap by default; add a Jawg access token in `config.js` to use Jawg.Sunny.

Map data (c) OpenStreetMap contributors, ODbL. Area boundaries are derived from PLZ polygons (c) OpenStreetMap contributors, ODbL (suche-postleitzahl.org).
