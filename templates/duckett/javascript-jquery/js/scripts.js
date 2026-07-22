// scripts.js — plain, modern JavaScript version.
// Wait for the HTML to be parsed before touching the DOM.
document.addEventListener('DOMContentLoaded', function () {

  /* ---------- DEMO 1 · TABS -------------------------------------------
     One click handler on the <ul> handles every tab (event delegation):
     we look at event.target to see which link was actually clicked. */
  var tabs = document.getElementById('tabs');

  tabs.addEventListener('click', function (event) {
    event.preventDefault();

    var link = event.target.closest('a[data-tab]');
    if (!link) return;                     // clicked the gap, not a tab

    var name = link.getAttribute('data-tab');

    // Update which tab looks active.
    tabs.querySelectorAll('a').forEach(function (a) {
      a.classList.toggle('active', a === link);
    });

    // Show the matching panel, hide the rest.
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === name);
    });
  });


  /* ---------- DEMO 2 · NOTE LIST --------------------------------------- */
  var input   = document.getElementById('noteInput');
  var addBtn  = document.getElementById('addNote');
  var notes   = document.getElementById('notes');

  function addNote() {
    var text = input.value.trim();
    if (text === '') return;

    // Build the <li> with createElement instead of innerHTML (safer, clearer).
    var li = document.createElement('li');

    var span = document.createElement('span');
    span.textContent = text;               // textContent escapes automatically

    var remove = document.createElement('span');
    remove.className = 'remove';
    remove.innerHTML = '&times;';

    li.appendChild(span);
    li.appendChild(remove);
    notes.appendChild(li);

    input.value = '';
    input.focus();
  }

  addBtn.addEventListener('click', addNote);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') addNote();
  });

  // Delegate removal: one handler on the list, for current and future items.
  notes.addEventListener('click', function (event) {
    if (event.target.classList.contains('remove')) {
      event.target.parentNode.remove();
    }
  });

});
