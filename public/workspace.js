function toggleDir(header) {
  header.classList.toggle('expanded');
  const content = header.nextElementSibling;
  if (content) content.classList.toggle('collapsed');
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main');
  if (!sidebar || !main) return;

  sidebar.classList.toggle('mobile-collapsed');
  if (sidebar.classList.contains('mobile-collapsed')) {
    sidebar.style.display = 'none';
    main.style.display = 'block';
  } else {
    sidebar.style.display = 'block';
    main.style.display = 'none';
  }
}

function isMobile() {
  return window.innerWidth <= 768;
}

document.querySelectorAll('.file-link').forEach(link => {
  link.addEventListener('click', function() {
    if (isMobile()) {
      const sidebar = document.querySelector('.sidebar');
      const main = document.querySelector('.main');
      if (!sidebar || !main) return;
      sidebar.classList.add('mobile-collapsed');
      sidebar.style.display = 'none';
      main.style.display = 'block';
    }
  });
});
