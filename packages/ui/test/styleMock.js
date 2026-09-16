// Stub for CSS/style imports under Jest. Several dynamic-table components do a
// side-effecting `import('./styles/*.css')` at module load (guarded on a browser
// `window`, which jsdom provides), so the test runtime must resolve those to an
// inert module instead of trying to parse CSS as JS.
module.exports = {}
