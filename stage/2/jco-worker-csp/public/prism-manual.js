// Runs before /vendor/prism/prism-core.min.js. Prism reads Prism.manual when
// it loads; true stops it from highlighting the whole page on DOMContentLoaded.
// main.js calls Prism.highlight() on each JS excerpt instead.
window.Prism = window.Prism || {};
window.Prism.manual = true;
