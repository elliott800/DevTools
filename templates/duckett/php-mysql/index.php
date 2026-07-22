<?php
/*
 * index.php — a working guestbook.
 *
 * Demonstrates the core server-side pattern from Duckett's PHP & MySQL:
 *   1. connect to the database (PDO)
 *   2. on POST, validate input and INSERT with a PREPARED STATEMENT
 *   3. redirect after saving (Post/Redirect/Get — stops double-submits)
 *   4. SELECT the rows and print them, ESCAPING every value on output
 *
 * The two security habits to copy from this file:
 *   • prepared statements (?) so user input can never become SQL
 *   • htmlspecialchars() on output so user input can never become HTML/JS
 */

require __DIR__ . '/includes/database.php';
$pdo = get_db();

$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Never trust incoming data — trim and check it first.
    $name    = trim($_POST['name']    ?? '');
    $message = trim($_POST['message'] ?? '');

    if ($name === '')    { $errors[] = 'Please enter your name.'; }
    if ($message === '') { $errors[] = 'Please write a message.'; }

    if (!$errors) {
        // PREPARED STATEMENT: the values are sent separately from the SQL,
        // so a name like  Robert'); DROP TABLE entries;--  is just text.
        $stmt = $pdo->prepare(
            'INSERT INTO entries (name, message, created_at) VALUES (?, ?, ?)'
        );
        $stmt->execute([$name, $message, date('Y-m-d H:i')]);

        // Redirect back to ourselves so a refresh doesn't re-post.
        header('Location: ' . $_SERVER['PHP_SELF']);
        exit;
    }
}

// Read every entry, newest first.
$entries = $pdo->query('SELECT * FROM entries ORDER BY id DESC')->fetchAll();

// Small helper so we never forget to escape output.
function e(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Guestbook — PHP &amp; MySQL Starter</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #2f2d2a;
      background: #f7f4ee; max-width: 620px; margin: 0 auto; padding: 2.5rem 1.25rem; }
    h1 { font-family: Georgia, serif; font-weight: normal; margin-bottom: .25rem; }
    .sub { color: #6a655c; margin-bottom: 2rem; }
    .card { background: #fffdf9; border: 1px solid #e2dccf; border-radius: 8px;
      padding: 1.5rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: .85rem; color: #6a655c; margin-bottom: .3rem; }
    input, textarea { width: 100%; padding: .6rem .7rem; font: inherit; margin-bottom: 1rem;
      border: 1px solid #cfc8b9; border-radius: 6px; background: #fffdf9; }
    input:focus, textarea:focus { outline: none; border-color: #3f6f4a; }
    button { font: inherit; cursor: pointer; border: none; border-radius: 6px;
      padding: .6rem 1.2rem; background: #3f6f4a; color: #fff; }
    .errors { background: #fbe9e4; border: 1px solid #e6b7a8; color: #8a3120;
      padding: .8rem 1rem; border-radius: 6px; margin-bottom: 1.5rem; font-size: .9rem; }
    .entry { border-bottom: 1px solid #e2dccf; padding: .9rem 0; }
    .entry:last-child { border-bottom: none; }
    .entry .who { font-weight: bold; }
    .entry .when { color: #9a9386; font-size: .8rem; }
    .empty { color: #9a9386; font-style: italic; }
  </style>
</head>
<body>

  <h1>Guestbook</h1>
  <p class="sub">A working PHP + database example. Data is stored with PDO
     (SQLite by default) and every value is escaped on the way out.</p>

  <div class="card">
    <?php if ($errors): ?>
      <div class="errors">
        <?php foreach ($errors as $error): ?>
          <div><?= e($error) ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <form method="post" action="<?= e($_SERVER['PHP_SELF']) ?>">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" value="<?= e($_POST['name'] ?? '') ?>">

      <label for="message">Message</label>
      <textarea id="message" name="message" rows="3"><?= e($_POST['message'] ?? '') ?></textarea>

      <button type="submit">Sign the guestbook</button>
    </form>
  </div>

  <div class="card">
    <h2 style="font-family:Georgia,serif;font-weight:normal;font-size:1.2rem;margin-bottom:1rem">
      <?= count($entries) ?> <?= count($entries) === 1 ? 'entry' : 'entries' ?>
    </h2>

    <?php if (!$entries): ?>
      <p class="empty">No one has signed yet — be the first.</p>
    <?php else: ?>
      <?php foreach ($entries as $entry): ?>
        <div class="entry">
          <div><span class="who"><?= e($entry['name']) ?></span>
               <span class="when">· <?= e($entry['created_at']) ?></span></div>
          <div><?= nl2br(e($entry['message'])) ?></div>
        </div>
      <?php endforeach; ?>
    <?php endif; ?>
  </div>

</body>
</html>
