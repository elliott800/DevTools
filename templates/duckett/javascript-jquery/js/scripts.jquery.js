// scripts.jquery.js — the SAME behaviour as scripts.js, written with jQuery.
// Compare the two files side by side to see what jQuery does for you.
// (Requires jquery.min.js to be loaded first — see index.html.)

$(function () {                            // shorthand for "DOM ready"

  /* ---------- DEMO 1 · TABS ------------------------------------------- */
  // Delegated click handler: bind once to #tabs, react to any <a> inside it.
  $('#tabs').on('click', 'a', function (event) {
    event.preventDefault();

    var name = $(this).data('tab');

    // Active tab.
    $('#tabs a').removeClass('active');
    $(this).addClass('active');

    // Matching panel.
    $('.tab-panel').removeClass('active')
      .filter('[data-panel="' + name + '"]').addClass('active');
  });


  /* ---------- DEMO 2 · NOTE LIST -------------------------------------- */
  function addNote() {
    var text = $.trim($('#noteInput').val());
    if (text === '') return;

    // Build the <li> with jQuery. .text() escapes the user input for us.
    var $li = $('<li>')
      .append($('<span>').text(text))
      .append($('<span class="remove">&times;</span>'));

    $('#notes').append($li);
    $('#noteInput').val('').focus();
  }

  $('#addNote').on('click', addNote);
  $('#noteInput').on('keydown', function (event) {
    if (event.key === 'Enter') addNote();
  });

  // Delegated removal for current and future items.
  $('#notes').on('click', '.remove', function () {
    $(this).parent().fadeOut(150, function () { $(this).remove(); });
  });

});
