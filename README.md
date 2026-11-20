# Secret Santa

A small, static Secret Santa app. Add your friends, set who shouldn't be matched, draw, and send each person a private link that shows only their own match.

- **Rules**: "Alice won't get Bob" (one way) or "Alice and Bob won't get each other" (both ways, good for couples).
- **Optional**: stop two people from drawing each other.
- **Private links**: each person opens their link and taps to reveal. The organizer never has to see the matches.
- **No backend**: everything runs in the browser and is saved in `localStorage`. Nothing is uploaded.

The links hide each match from a quick glance, but they aren't encrypted. Someone who really wants to could decode their own link. That's fine among friends, but don't use it for anything sensitive.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Host on GitHub Pages

```sh
git init -b main
git add .
git commit -m "Secret Santa app"
gh repo create secret-santa --public --source . --push
gh api repos/{owner}/secret-santa/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

Or in the GitHub UI: **Settings → Pages → Deploy from a branch → `main` / root**. The site appears at `https://<your-username>.github.io/secret-santa/` after a minute or so.

## Files

- `index.html`: the organizer screen and the reveal screen
- `style.css`: styles, with light and dark mode
- `app.js`: the matching logic and the UI
