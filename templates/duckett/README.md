# Duckett-style starters

Original, **MIT-licensed** starter templates written in the teaching style of
**Jon Duckett's** three books — clean semantic markup, separation of concerns,
heavy explanatory comments, and the security habits his PHP book drills in.
These are *inspired by* the books; they are not the books' code (that's
copyrighted — see the official free downloads below).

## What's here

| Folder | In the style of | Teaches |
|--------|-----------------|---------|
| [`html-css/`](html-css/) | *HTML & CSS: Design and Build Websites* | Semantic HTML5 (`header/main/section/article/aside/footer`), external stylesheet, responsive grid, accessible forms. |
| [`javascript-jquery/`](javascript-jquery/) | *JavaScript & jQuery: Interactive Front-End Web Development* | The **same** tabs + note-list built twice — plain JS (`scripts.js`) and jQuery (`scripts.jquery.js`) — so you can compare. Event delegation, `classList`, `createElement`. |
| [`php-mysql/`](php-mysql/) | *PHP & MySQL: Server-side Web Development* | A working guestbook: PDO, **prepared statements**, Post/Redirect/Get, and `htmlspecialchars()` on every output. Runs on SQLite with zero setup. |

## Run them (from `DevTools/`)

```powershell
# HTML & CSS — static
node serve.js templates/duckett/html-css

# JavaScript & jQuery — static. Vanilla version works as-is.
node serve.js templates/duckett/javascript-jquery
# To try the jQuery version (it uses the shared templates/vendor/jquery),
# serve the whole templates folder instead, then open /duckett/javascript-jquery/ :
node serve.js templates

# PHP & MySQL — served by php -S; creates data/guestbook.sqlite on first run
node serve.js templates/duckett/php-mysql
```

The PHP starter needs PHP with `pdo_sqlite` (bundled with XAMPP's PHP, which
DevTools already points at). To use MySQL instead, edit
[`php-mysql/includes/database.php`](php-mysql/includes/database.php) — the two
lines to swap are marked.

## Official free code downloads (from the books)

If you want the *actual* example code from the books, the authors provide it free:

- **HTML & CSS** — code samples: <http://www.htmlandcssbook.com/code-samples/>
  (also linked as <http://www.htmlandcssbook.com/code/>)
- **JavaScript & jQuery** — code by chapter: <http://www.javascriptbook.com/code/>
- **PHP & MySQL** — publisher page (Wiley): <https://www.wiley.com/en-us/PHP+&+MySQL:+Server-side+Web+Development-p-9781119149217>
  · community exercises repo: <https://github.com/jojo342/php-mqsql-book>

Those downloads are the authors'/publisher's material — grab them from the links
rather than committing them here, so licensing stays clean.

## Licensing

Everything in *this* folder is original work, free for you to copy, edit, and
commit into your own sites. The books, their text, and their example code remain
© Jon Duckett / Wiley.
