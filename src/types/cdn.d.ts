// chartjs-plugin-zoom extends Chart.js types via module augmentation,
// adding Chart.Options.plugins.zoom options. The side-effect import is
// needed so tsc picks up the augmentation at every Chart usage site.
import "chartjs-plugin-zoom";
