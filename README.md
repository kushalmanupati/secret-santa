# Secret Santa

A small, static Secret Santa app. Add your friends, set who shouldn't be matched, draw, and send each person a private link that shows only their own match.

- **Rules**: "Alice won't get Bob" (one way) or "Alice and Bob won't get each other" (both ways, good for couples).
- **Optional**: stop two people from drawing each other.
- **Private links**: each person opens their link and taps to reveal. The organizer never has to see the matches.
- **No backend**: everything runs in the browser and is saved in `localStorage`. Nothing is uploaded.

The links hide each match from a quick glance, but they aren't encrypted. Someone who really wants to could decode their own link. That's fine among friends, but don't use it for anything sensitive.

## Reveal tracking (optional)

When someone taps **Reveal**, the page records `{draw ID, random token, time}` in Firestore. Names and matches are never sent. The organizer screen and a shareable **status page** use these records to show who has revealed and who is still pending.

To turn tracking on, put your Firebase `apiKey` and `projectId` in `config.js`, then publish these Firestore rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /draws/{drawId}/reveals/{token} {
      allow read: if true;
      allow create: if drawId.size() >= 16 && drawId.size() <= 40
                    && token.size() >= 8 && token.size() <= 40
                    && request.resource.data.keys().hasOnly(['at'])
                    && request.resource.data.at is timestamp;
      allow update, delete: if false;
    }
    match /draws/{drawId}/wishes/{key} {
      function valid() {
        let d = request.resource.data;
        return drawId.size() >= 16 && drawId.size() <= 40 && key.size() == 32
          && d.keys().hasOnly(['items', 'at']) && d.at is timestamp
          && d.items is list && d.items.size() <= 2
          && (d.items.size() < 1 || (d.items[0] is string && d.items[0].size() <= 120))
          && (d.items.size() < 2 || (d.items[1] is string && d.items[1].size() <= 120));
      }
      allow get: if true;
      allow list: if false;
      allow create, update: if valid();
      allow delete: if false;
    }
  }
}
```

Wishlists are stored under a key derived from the draw ID and the person's name, so the person drawing them can look them up. They contain only the gift ideas, never names or matches.

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
