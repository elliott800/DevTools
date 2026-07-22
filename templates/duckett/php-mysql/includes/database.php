<?php
/*
 * database.php — returns a PDO connection.
 *
 * Defaults to a local SQLite file so this starter runs with ZERO setup
 * (just `php -S`, or `node serve.js` from DevTools). To use a real
 * MySQL/MariaDB server instead, comment the SQLite block and uncomment
 * the MySQL one.
 *
 * Keeping the connection in its own file (included where needed) is the
 * separation Jon Duckett's PHP & MySQL book encourages.
 */

function get_db(): PDO
{
    // ---- OPTION A · SQLite (default — no database server required) ----
    $path = __DIR__ . '/../data/guestbook.sqlite';
    if (!is_dir(dirname($path))) {
        mkdir(dirname($path), 0777, true);
    }
    $pdo = new PDO('sqlite:' . $path);

    // ---- OPTION B · MySQL (uncomment to use a real server) ----
    // $dsn = 'mysql:host=127.0.0.1;dbname=guestbook;charset=utf8mb4';
    // $pdo = new PDO($dsn, 'root', '');   // <-- your username / password

    // Make PDO report problems as exceptions and hand back plain arrays.
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    // Create the table on first run.
    // NOTE: AUTOINCREMENT is SQLite syntax. For MySQL use:
    //   id INT AUTO_INCREMENT PRIMARY KEY
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS entries (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            message    TEXT NOT NULL,
            created_at TEXT NOT NULL
        )'
    );

    return $pdo;
}
