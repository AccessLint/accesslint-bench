/**
 * Shared Highcharts renderer for benchmark pages.
 *
 * Progressive enhancement: bails silently if Highcharts is not loaded.
 * Reads <script type="application/json" id="chart-data-*"> elements
 * and renders into matching <div id="chart-*"> containers.
 */
(function () {
  "use strict";

  if (typeof Highcharts === "undefined") return;

  var COLORS = {
    axe: "#555555",
    accesslint: "#0055cc",
  };

  // Shared defaults
  Highcharts.setOptions({
    credits: { enabled: false },
    accessibility: { enabled: true },
    chart: {
      style: { fontFamily: "system-ui, -apple-system, sans-serif" },
    },
    colors: [COLORS.axe, COLORS.accesslint],
  });

  function readData(id) {
    var el = document.getElementById("chart-data-" + id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (_) {
      return null;
    }
  }

  // --- Index page charts ---

  // Grouped bar: median audit time per tool
  function renderSpeedChart() {
    var data = readData("speed");
    var container = document.getElementById("chart-speed");
    if (!data || !container) return;

    Highcharts.chart(container, {
      chart: { type: "bar", height: 180 },
      title: { text: null },
      xAxis: {
        categories: data.categories,
        labels: { style: { fontSize: "14px" } },
      },
      yAxis: {
        title: { text: "Milliseconds" },
        min: 0,
      },
      tooltip: { valueSuffix: " ms" },
      legend: { enabled: false },
      series: [
        {
          name: "Median audit time",
          data: data.values.map(function (v, i) {
            return { y: v, color: data.colors[i] };
          }),
        },
      ],
      accessibility: {
        description: "Bar chart comparing median audit time across tools.",
      },
    });
  }

  // Stacked bar: @accesslint/core detections with confirmation breakdown
  function renderConcordanceChart() {
    var data = readData("concordance");
    var container = document.getElementById("chart-concordance");
    if (!data || !container) return;

    Highcharts.chart(container, {
      chart: { type: "bar", height: 40 * data.categories.length + 120 },
      title: { text: null },
      xAxis: {
        categories: data.categories,
        labels: { style: { fontSize: "13px" } },
      },
      yAxis: {
        min: 0,
        title: { text: "Sites" },
        stackLabels: { enabled: false },
      },
      tooltip: {
        headerFormat: "<b>{point.x}</b><br/>",
        pointFormat: "{series.name}: {point.y}<br/>Total: {point.stackTotal}",
      },
      plotOptions: {
        bar: {
          stacking: "normal",
          dataLabels: { enabled: false },
        },
      },
      legend: { reversed: true },
      series: [
        { name: "axe confirms", data: data.axeConfirms, color: COLORS.axe },
        { name: "Unique", data: data.accesslintUnique, color: "#bf8700" },
      ],
      accessibility: {
        description:
          "Stacked bar chart showing @accesslint/core detections and confirmation by axe-core per WCAG criterion.",
      },
    });
  }

  // Kappa display: simple + weighted mean
  function renderKappaChart() {
    var data = readData("kappa");
    var container = document.getElementById("chart-kappa");
    if (!data || !container) return;

    Highcharts.chart(container, {
      chart: { type: "bar", height: 180 },
      title: { text: null },
      xAxis: {
        categories: ["Simple mean", "Weighted mean"],
        labels: { style: { fontSize: "14px" } },
      },
      yAxis: {
        title: { text: "Cohen\u2019s \u03BA" },
        min: -0.2,
        max: 1,
        plotBands: [
          { from: 0.6, to: 1, color: "rgba(26, 127, 55, 0.08)", label: { text: "Substantial", style: { color: "#1a7f37" } } },
        ],
      },
      tooltip: {
        pointFormat: "\u03BA = {point.y:.2f}",
      },
      legend: { enabled: false },
      series: [
        {
          name: "axe \u2194 accesslint",
          data: [
            { y: data.simpleMean, color: COLORS.accesslint },
            { y: data.weightedMean, color: COLORS.accesslint },
          ],
        },
      ],
      accessibility: {
        description: "Bar chart showing mean Cohen's kappa between axe-core and @accesslint/core.",
      },
    });
  }

  // --- Drilldown page charts ---

  // Donut: agreement breakdown
  function renderAgreementChart() {
    var data = readData("agreement");
    var container = document.getElementById("chart-agreement");
    if (!data || !container) return;

    Highcharts.chart(container, {
      chart: { type: "pie", height: 300 },
      title: { text: null },
      plotOptions: {
        pie: {
          innerSize: "55%",
          dataLabels: {
            enabled: true,
            format: "<b>{point.name}</b>: {point.y}",
            style: { fontSize: "13px" },
          },
        },
      },
      series: [
        {
          name: "Sites",
          data: [
            { name: "Both", y: data.both, color: "#1a7f37" },
            { name: "axe-core only", y: data.axeOnly, color: COLORS.axe },
            { name: "@accesslint/core only", y: data.accesslintOnly, color: COLORS.accesslint },
          ].filter(function (d) {
            return d.y > 0;
          }),
        },
      ],
      accessibility: {
        description: "Donut chart showing agreement breakdown for this criterion.",
      },
    });
  }

  // Horizontal bar: top rules per tool
  function renderRulesChart() {
    var data = readData("rules");
    var container = document.getElementById("chart-rules");
    if (!data || !container) return;

    var allCategories = [];
    var seen = {};
    var tools = ["axe", "accesslint"];
    var toolLabels = { axe: "axe-core", accesslint: "@accesslint/core" };

    tools.forEach(function (t) {
      (data[t] || []).forEach(function (r) {
        if (!seen[r.ruleId]) {
          seen[r.ruleId] = true;
          allCategories.push(r.ruleId);
        }
      });
    });

    if (allCategories.length === 0) return;

    var series = tools.map(function (t) {
      var ruleMap = {};
      (data[t] || []).forEach(function (r) {
        ruleMap[r.ruleId] = r.count;
      });
      return {
        name: toolLabels[t],
        color: COLORS[t],
        data: allCategories.map(function (cat) {
          return ruleMap[cat] || 0;
        }),
      };
    });

    Highcharts.chart(container, {
      chart: { type: "bar", height: 30 * allCategories.length + 120 },
      title: { text: null },
      xAxis: {
        categories: allCategories,
        labels: { style: { fontSize: "12px" } },
      },
      yAxis: {
        min: 0,
        title: { text: "Sites" },
      },
      tooltip: {
        headerFormat: "<b>{point.x}</b><br/>",
        pointFormat: "{series.name}: {point.y}",
      },
      plotOptions: {
        bar: { groupPadding: 0.1 },
      },
      series: series,
      accessibility: {
        description: "Horizontal bar chart showing top rules per tool.",
      },
    });
  }

  // --- Init ---

  renderSpeedChart();
  renderConcordanceChart();
  renderKappaChart();
  renderAgreementChart();
  renderRulesChart();
})();
