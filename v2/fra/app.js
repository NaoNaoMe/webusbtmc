'use strict';

import GetCurve from './getCurve.js';
import { MAX_DATA_POINTS } from './chartConfig.js';
import { userColors } from './chartConfig.js';
import { setupConnectButton, showMessage, clearMessages } from '../common/ui.js';

let worker = new GetCurve();
let isTSVonWave = false;
let isTSVonBode = false;
let frequencyUnit = 'Hz';
let subckt_num = 1;

// Get DOM elements
const waveformCtx = document.getElementById('waveformChart').getContext('2d', { willReadFrequently: true });
const lissajousCtx = document.getElementById('lissajousChart').getContext('2d', { willReadFrequently: true });

const magnitudeCtx = document.getElementById('magnitudePlot').getContext('2d', { willReadFrequently: true });
const phaseCtx = document.getElementById('phasePlot').getContext('2d', { willReadFrequently: true });

const nyquistCtx = document.getElementById('nyquistPlot').getContext('2d', { willReadFrequently: true });

const magnitudeCanvas = document.getElementById('magnitudePlot').closest('canvas');
const phaseCanvas = document.getElementById('phasePlot').closest('canvas');
const nyquistCanvas = document.getElementById('nyquistPlot').closest('canvas');

const fetchButton = document.getElementById('fetch-button');
const autoFetchCheckbox = document.getElementById('auto-fetch-checkbox');

const exportAsTsvWaveformButton = document.getElementById('tsv-waveform-button'); 
const exportWaveformButton = document.getElementById('export-waveform-button');
const toggleWaveformChartButton = document.getElementById('toggle-waveform-chart');
const toggleLissajousChartButton = document.getElementById('toggle-lissajous-chart');

const clearPlotsButton = document.getElementById('clear-plots-button');

const exportAsTsvBodePlotButton = document.getElementById('tsv-bodeplot-button');
const importBodePlot = document.getElementById('import-bodeplot-file');
const exportBodePlotButton = document.getElementById('export-bodeplot-button');
const copy2clipboardBodePlotButton = document.getElementById('copy2clipboard-bodeplot-button');

const generateSubcktButton = document.getElementById('generate-subckt-button');
const toggleFrequencyUnitButton = document.getElementById('toggle-frequency-unit');
const toggleBodeNyquistPlotButton = document.getElementById('toggle-bode-nyquist-plot');

const toggleNyquistPlotButton = document.getElementById('toggle-nyquist-plot');

const enableDeleteSwitch = document.getElementById('enable-delete-switch');
const trimBodePlotButton = document.getElementById('trimBodePlotButton');

const enableKeydownCheckbox = document.getElementById('enable-keydown-checkbox');

// Store the default HTML content of the each buttons
const defaultFetchButtonHTML = fetchButton.innerHTML;

// Spinner and icon HTML snippets
const spinnerWidget = '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>';
const puaseIcon ='<i class="bi bi-pause"></i>';

// Define class names as constants
const spreadsheetfillClass = 'bi-file-earmark-spreadsheet-fill';
const spreadsheetClass = 'bi-file-earmark-spreadsheet';

const clipboardClass = 'bi-clipboard';
const clipboard2checkClass = 'bi-clipboard2-check';

// Function to generate points on a unit circle
function generateUnitCirclePoints(numPoints = 200) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        points.push({ x: Math.cos(angle), y: Math.sin(angle) });
    }
    return points;
}

const unitCirclePoints = generateUnitCirclePoints();

// Chart configurations
const waveformConfig = {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Ch1',
                data: [],
                fill: false,
                showLine: true,
                pointRadius: 0,
                pointHoverRadius: 0,
                yAxisID: 'y1',
            },
            {
                label: 'Ch1_filtered',
                borderDash: [6, 3],
                data: [],
                fill: false,
                showLine: true,
                pointRadius: 0,
                pointHoverRadius: 0,
                yAxisID: 'y1',
                hidden: true,
            },
            {
                label: 'Ch2',
                data: [],
                fill: false,
                showLine: true,
                pointRadius: 0,
                pointHoverRadius: 0,
                yAxisID: 'y2',
            },
            {
                label: 'Ch2_filtered',
                borderDash: [6, 3],
                data: [],
                fill: false,
                showLine: true,
                pointRadius: 0,
                pointHoverRadius: 0,
                yAxisID: 'y2',
                hidden: true,
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: {
                display: true
            },
            tooltip: {
                callbacks: {
                    title: function (context) {
                        let value = context[0].chart.data.labels[context[0].dataIndex];
                        let title = `T:${value.toExponential(2)} sec`;
                        return title;
                    },
                    label: function (context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        label += context.parsed.y;
                        return label;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                position: 'bottom',
                title: {
                    display: true,
                    text: 't (sec.)'
                },
                ticks: {
                    callback: function (value) {
                        return value.toExponential(2);
                    }
                }
            },
            y1: {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Amplitude Ch1'
                }
            },
            y2: {
                type: 'linear',
                position: 'right',
                title: {
                    display: true,
                    text: 'Amplitude Ch2'
                },
                grid: {
                    drawOnChartArea: false
                }
            }
        },
        layout: {
            padding: {
                left: 10,
                right: 10,
                top: 20,
                bottom: 20
            }
        }
    }
};

const lissajousConfig = {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'xy',
                data: [],
                fill: false,
                showLine: true,
                pointRadius: 0,
                pointHoverRadius: 0,
            },
            {
                label: 'xy_filterd',
                borderDash: [6, 3],
                data: [],
                fill: false,
                showLine: true,
                pointRadius: 0,
                pointHoverRadius: 0,
                hidden: true,
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            tooltip: {
                enabled: false
            }
        },
        scales: {
            x: {
                type: 'linear',
                position: 'bottom',
                title: {
                    display: true,
                    text: 'Channel 1'
                }
            },
            y: {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Channel 2'
                }
            }
        },
        layout: {
            padding: {
                left: 10,
                right: 10,
                top: 20,
                bottom: 20
            }
        }
    }
};

const magnitudeConfig = {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Magnitude (dB)',
            data: [],
            borderColor: userColors.blue[6],
            pointBackgroundColor: userColors.blue[4],
            showLine: false,
            fill: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: {
                left: 10,
                right: 10,
                top: 20,
                bottom: 20
            }
        },
        scales: {
            x: {
                type: 'logarithmic',
                position: 'bottom',
                title: {
                    display: true,
                    text: 'Frequency'
                },
                ticks: {
                    callback: (value) => {
                        return frequencyUnit === 'Hz' ? `${value} Hz` : `${(value * 2 * Math.PI).toFixed(2)} rad/s`;
                    }
                }
            },
            y: {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Magnitude (dB)'
                },
                ticks: {
                    stepSize: 20
                },
                grid: {
                    color: () => Chart.defaults.borderColor,
                    lineWidth: 1
                }
            }
        },
        plugins: {
            tooltip: {
                callbacks: {
                    title: function (context) {
                        let value = context[0].chart.data.labels[context[0].dataIndex];
                        let title = 'Frequency:';
                        if(frequencyUnit === 'Hz') {
                            title += `${value.toFixed(3)} Hz`;
                        }
                        else {
                            title += `${(value * 2 * Math.PI).toFixed(2)} rad/s`;
                        }

                        return title;
                    },
                    label: (context) => `${context.dataset.label}: ${context.raw.toFixed(3)}`
                }
            },
            legend: {
                display: false
            }
        }
    }
};

const phaseConfig = {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Phase (degrees)',
            data: [],
            borderColor: userColors.red[6],
            pointBackgroundColor: userColors.red[4],
            showLine: false,
            fill: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: {
                left: 10,
                right: 10,
                top: 20,
                bottom: 20
            }
        },
        scales: {
            x: {
                type: 'logarithmic',
                position: 'bottom',
                title: {
                    display: true,
                    text: 'Frequency'
                },
                ticks: {
                    callback: (value) => {
                        return frequencyUnit === 'Hz' ? `${value} Hz` : `${(value * 2 * Math.PI).toFixed(2)} rad/s`;
                    }
                }
            },
            y: {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Phase (degrees)'
                },
                ticks: {
                    stepSize: 45
                },
                grid: {
                    color: () => Chart.defaults.borderColor,
                    lineWidth: 1
                }
            }
        },
        plugins: {
            tooltip: {
                callbacks: {
                    title: function (context) {
                        let value = context[0].chart.data.labels[context[0].dataIndex];
                        let title = 'Frequency:';
                        if(frequencyUnit === 'Hz') {
                            title += `${value.toFixed(3)} Hz`;
                        }
                        else {
                            title += `${(value * 2 * Math.PI).toFixed(2)} rad/s`;
                        }

                        return title;
                    },
                    label: (context) => `${context.dataset.label}: ${context.raw.toFixed(3)}`
                }
            },
            legend: {
                display: false
            }
        }
    }
};

const nyquistConfig = {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Nyquist Plot',
            data: [],
            fill: false,
            showLine: false,
            tooltip: true
        },
        {
            label: 'Unit Circle',
            borderColor: userColors.blue[4],
            pointBackgroundColor: userColors.blue[4],
            data: unitCirclePoints,
            fill: false,
            showLine: true,
            pointRadius: 0,
            pointHoverRadius: 0,
            borderDash: [5, 5],
            tooltip: false
        },
        {
            label: 'Stability Point',
            borderColor: userColors.red[6],
            pointBackgroundColor: userColors.red[6],
            data: [{ x: -1, y: 0 }],
            fill: false,
            showLine: false,
            pointRadius: 5,
            pointHoverRadius: 5,
            tooltip: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: {
            padding: {
                left: 10,
                right: 10,
                top: 20,
                bottom: 20
            }
        },
        scales: {
            x: {
                type: 'linear',
                max: 1.5,
                min: -1.5,
                position: 'bottom',
                title: {
                    display: true,
                    text: 'Real Part'
                },
                ticks: {
                    stepSize: 0.5
                }
            },
            y: {
                type: 'linear',
                max: 1.5,
                min: -1.5,
                position: 'left',
                title: {
                    display: true,
                    text: 'Imaginary Part'
                },
                ticks: {
                    stepSize: 0.5
                }
            }
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                filter: function (tooltipItem) {
                    // Filter out tooltips for datasets that have tooltip disabled
                    return tooltipItem.dataset.tooltip !== false;
                },
                callbacks: {
                    title: function (context) {
                        if (!context[0]) {
                            return '';
                        }
                        let value = context[0].chart.data.labels[context[0].dataIndex];
                        let title = 'Frequency:';
                        if(frequencyUnit === 'Hz') {
                            title += `${value.toFixed(3)} Hz`;
                        }
                        else {
                            title += `${(value * 2 * Math.PI).toFixed(2)} rad/s`;
                        }

                        return title;
                    },
                    label: (context) => `Real: ${context.parsed.x.toFixed(3)}, Imag: ${context.parsed.y.toFixed(3)}`
                }
            }
        }
    }
};


// Create charts
const waveformChart = new Chart(waveformCtx, waveformConfig);
const lissajousChart = new Chart(lissajousCtx, lissajousConfig);
const magnitudePlot = new Chart(magnitudeCtx, magnitudeConfig);
const phasePlot = new Chart(phaseCtx, phaseConfig);
const nyquistChart = new Chart(nyquistCtx, nyquistConfig);

// Chart text and grid follow the theme of the page
function applyChartTheme() {
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted').trim();
    const line = css.getPropertyValue('--line').trim();
    Chart.defaults.color = text;
    Chart.defaults.borderColor = line;
    // Existing charts keep the colours they resolved earlier, so set them on each chart.
    for (const chart of [waveformChart, lissajousChart, magnitudePlot, phasePlot, nyquistChart]) {
        for (const scale of Object.values(chart.options.scales)) {
            scale.ticks.color = text;
            scale.grid.color = line;
            scale.title.color = text;
        }
        chart.options.plugins.legend.labels.color = text;
    }

    // Channel colours of an oscilloscope: CH1 and its axis, CH2 and its axis
    const ch1 = css.getPropertyValue('--ch1').trim();
    const ch2 = css.getPropertyValue('--ch2').trim();
    const accent = css.getPropertyValue('--accent').trim();
    const paint = (dataset, color) => {
        dataset.borderColor = color;
        dataset.pointBackgroundColor = color;
    };
    const [wave1, wave1Filtered, wave2, wave2Filtered] = waveformChart.data.datasets;
    paint(wave1, ch1);
    paint(wave1Filtered, ch1);
    paint(wave2, ch2);
    paint(wave2Filtered, ch2);
    for (const [axis, color] of [['y1', ch1], ['y2', ch2]]) {
        waveformChart.options.scales[axis].ticks.color = color;
        waveformChart.options.scales[axis].title.color = color;
    }
    for (const dataset of lissajousChart.data.datasets) {
        paint(dataset, accent);
    }
    paint(nyquistChart.data.datasets[0], accent);

    for (const chart of [waveformChart, lissajousChart, magnitudePlot, phasePlot, nyquistChart]) {
        chart.update('none');
    }
}
applyChartTheme();
window.addEventListener('tmc-themechange', applyChartTheme);

// ---- Last measurement (the numbers behind the newest point)
let lastAnalysed = null;

function formatFrequency(hz) {
    const value = frequencyUnit === 'Hz' ? hz : hz * 2 * Math.PI;
    const [scale, prefix] = [[1e6, 'M'], [1e3, 'k'], [1, '']].find(([s]) => Math.abs(value) >= s) || [1, ''];
    return (value / scale).toPrecision(4) + ' ' + prefix + frequencyUnit;
}

function showLastMeasurement(analysed) {
    lastAnalysed = analysed;
    const dash = '\u2014';
    document.getElementById('last-freq').textContent = analysed ? formatFrequency(analysed.freq) : dash;
    document.getElementById('last-gain').textContent = analysed ? (20 * Math.log10(analysed.gain)).toFixed(2) + ' dB' : dash;
    document.getElementById('last-phase').textContent = analysed ? (analysed.phase_rad * 180 / Math.PI).toFixed(1) + '\u00b0' : dash;
}

// ---- Plots that were not saved yet (saved = exported, copied or loaded from a file)
let plotsSaved = true;
const markPlotsChanged = () => { plotsSaved = false; };
const markPlotsSaved = () => { plotsSaved = true; };

// Leaving the page closes the connection and drops the plots, so ask first.
window.addEventListener('beforeunload', (event) => {
    const unsavedPlots = magnitudePlot.data.labels.length > 0 && !plotsSaved;
    if (worker.opened || unsavedPlots) {
        event.preventDefault();
    }
});

// ---- Why a fetch gave nothing
const CAPTURE_PROBLEMS = {
    'no-waveform': ['The instrument has no waveform to read.', 'Check that CH1 and CH2 are on and show a signal, and that the instrument is running.'],
    'format-changed': ['The instrument was set to send waveforms as bytes.', 'Press Fetch again.'],
    'length-mismatch': ['CH1 and CH2 returned different numbers of points.', 'Check that both channels are on, then press Fetch again.'],
};

// Why the waveforms cannot be analysed, or null when they can.
function analysisProblem(analysed) {
    if (!isFinite(analysed.freq)) {
        return ['The frequency of CH1 could not be found.',
            'CH1 must show at least two periods of a sine wave with a large enough amplitude. Adjust the horizontal and vertical ranges of the oscilloscope.'];
    }
    // With few periods the spread says little. With more, a real sine wave has nearly equal periods.
    if (analysed.periodCount >= 3 && analysed.periodSpread > 0.3) {
        return ['The signal in CH1 is too small or not a steady sine wave.',
            'Check that the output of the generator is on, then increase the amplitude or adjust the vertical range of the oscilloscope.'];
    }
    if (!(analysed.gain > 0) || !isFinite(analysed.gain)) {
        return ['CH2 shows no signal.', 'Check the connection to the output of the circuit and the vertical range of CH2.'];
    }
    return null;
}

// Button event listeners
fetchButton.onclick = handleActionButtonClick;
clearPlotsButton.onclick = handleClearPlotsButtonClick;
exportAsTsvBodePlotButton.onclick = handleExportAsTsvBodePlotButtonClick
exportBodePlotButton.onclick = handleExportBodePlotClick;
copy2clipboardBodePlotButton.onclick = handleCopy2clipboardBodePlotClick;
generateSubcktButton.onclick = handleGenerateSubcktButtonClick;
exportAsTsvWaveformButton.onclick = handleExportAsTsvWaveformButtonClick;
exportWaveformButton.onclick = handleExportWaveformClick;
toggleLissajousChartButton.onclick = handleToggleLissajousChartClick;
toggleWaveformChartButton.onclick = handleToggleChartClick;
toggleBodeNyquistPlotButton.onclick = handleTogglePlotClick;
toggleNyquistPlotButton.onclick = handleToggleNyquistPlotClick;
toggleFrequencyUnitButton.onclick = handleToggleFrequencyUnitClick;
trimBodePlotButton.onclick = handleTrimBodePlotButtonClick;
importBodePlot.addEventListener('change', handleImportBodePlotChange);
enableKeydownCheckbox.addEventListener('change', toggleKeydownEvent);

setupConnectButton({
    isOpen: () => worker.opened,
    open: (device) => worker.open(device),
    close: () => worker.close(),
    onChange: (state) => { fetchButton.disabled = state !== 'on'; },
});


let isDragging = false;
let startPoint = { x: 0, y: 0 };
let endPoint = { x: 0, y: 0 };
let savedImageMagnitudeData;
let savedImagePhaseData;
let savedImageNyquistData;
let selectedDataPointIndex = null;
let isFetchDataInterval = false;

// Chart click handlers for data deletion
magnitudeCtx.canvas.onclick = handleClick;
phaseCtx.canvas.onclick = handleClick;
nyquistCtx.canvas.onclick = handleClick;

// Setup canvas event listeners for data selection
setupCanvasEventListeners(magnitudeCanvas, magnitudeCtx, magnitudePlot, savedImageMagnitudeData, startPoint, endPoint);
setupCanvasEventListeners(phaseCanvas, phaseCtx, phasePlot, savedImagePhaseData, startPoint, endPoint);
setupCanvasEventListeners(nyquistCanvas, nyquistCtx, nyquistChart, savedImageNyquistData, startPoint, endPoint);

function handleToggleLissajousChartClick() {
    const waveformContainer = document.getElementById('waveformContainer');
    const lissajousContainer = document.getElementById('lissajousContainer');

    if (lissajousContainer.style.display === 'none') {
        lissajousContainer.style.display = 'block';
        waveformContainer.classList.remove('w-100');
        waveformContainer.classList.add('w-50');
    } else {
        lissajousContainer.style.display = 'none';
        waveformContainer.classList.remove('w-50');
        waveformContainer.classList.add('w-100');
    }
}

function handleToggleNyquistPlotClick() {
    const bodePlotContainer = document.getElementById('bodePlotContainer');
    const nyquistPlotContainer = document.getElementById('nyquistPlotContainer');

    if (nyquistPlotContainer.style.display === 'none') {
        nyquistPlotContainer.style.display = 'block';
        bodePlotContainer.classList.remove('w-100');
        bodePlotContainer.classList.add('w-50');
    } else {
        nyquistPlotContainer.style.display = 'none';
        bodePlotContainer.classList.remove('w-50');
        bodePlotContainer.classList.add('w-100');
    }
}

function toggleVisibility(element) {
    if (element.style.display === 'none') {
        element.style.display = 'block';
    } else {
        element.style.display = 'none';
    }
}

function handleToggleChartClick() {
    toggleVisibility(document.getElementById('chartContainer'));
}

function handleTogglePlotClick() {
    toggleVisibility(document.getElementById('plotContainer'));
}

function handleActionButtonClick() {
    clearMessages();
    if (magnitudePlot.data.labels.length >= MAX_DATA_POINTS || phasePlot.data.labels.length >= MAX_DATA_POINTS) {
        showMessage('warn', 'Maximum data points reached.', 'Clear the plots to continue.');
        return;
    }

    if (isFetchDataInterval && autoFetchCheckbox.checked) {
        isFetchDataInterval = false;
        fetchButton.innerHTML = defaultFetchButtonHTML;
        autoFetchCheckbox.disabled = false;
    } else {
        if (worker.IsBusy) {
            // Worker is busy, handle accordingly
        } else {
            if (autoFetchCheckbox.checked) {
                isFetchDataInterval = true;
                autoFetchCheckbox.disabled = true;
            }
        
            fetchButton.innerHTML = puaseIcon + ' Fetching waveforms';
            enableDeleteSwitch.checked = false;

            fetchData();
        }
    }
}

function handleClearPlotsButtonClick() {

    if( magnitudePlot.data.datasets[0].data.length <= 0 &&
        phasePlot.data.datasets[0].data.length <= 0 &&
        nyquistChart.data.datasets[0].data.length <= 0)
    {
        return;
    }

    const isConfirmed = confirm('Are you sure to delete the plots?');
    if (!isConfirmed) {
        return;
    }

    magnitudePlot.data.labels = [];
    magnitudePlot.data.datasets[0].data = [];
    magnitudePlot.update();

    phasePlot.data.labels = [];
    phasePlot.data.datasets[0].data = [];
    phasePlot.update();
    
    nyquistChart.data.labels = [];
    nyquistChart.data.datasets[0].data = [];
    nyquistChart.update();
}

function handleExportAsTsvWaveformButtonClick() {
    const icon = exportAsTsvWaveformButton.querySelector("i");

    if(isTSVonWave) {
        isTSVonWave = false;
        icon.classList.replace(spreadsheetfillClass, spreadsheetClass);
    }
    else {
        isTSVonWave = true;
        icon.classList.replace(spreadsheetClass, spreadsheetfillClass);
    }
}

function handleExportWaveformClick() {
    if (waveformChart.data.labels.length === 0) {
        return;
    }
    const isTSV = isTSVonWave;
    const fileExtension = isTSV ? 'txt' : 'csv';
    const fileName = `waveform_data.${fileExtension}`;

    const times = waveformChart.data.labels;
    const ch1_raw = waveformChart.data.datasets[0].data;
    const ch1_filtered = waveformChart.data.datasets[1].data;
    const ch2_raw = waveformChart.data.datasets[2].data;
    const ch2_filtered = waveformChart.data.datasets[3].data;

    let content;
    if(isTSV) {
        content = createTSVContent(times, ch1_raw, ch1_filtered, ch2_raw, ch2_filtered);
    }
    else {
        content = createCSVContent(times, ch1_raw, ch1_filtered, ch2_raw, ch2_filtered);
    }


    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function handleExportAsTsvBodePlotButtonClick() {
    const icon = exportAsTsvBodePlotButton.querySelector("i");

    if(isTSVonBode) {
        isTSVonBode = false;
        icon.classList.replace(spreadsheetfillClass, spreadsheetClass);
    }
    else {
        isTSVonBode = true;
        icon.classList.replace(spreadsheetClass, spreadsheetfillClass);
    }
}

function handleExportBodePlotClick() {
    if (magnitudePlot.data.labels.length === 0) {
        return;
    }

    const isTSV = isTSVonBode;
    const fileExtension = isTSV ? 'txt' : 'csv';
    const fileName = `bode_plot_data`;

    const processed = processBodeData(magnitudePlot.data.labels, magnitudePlot.data.datasets[0].data, phasePlot.data.datasets[0].data);

    let contents;
    if(isTSV) {
        contents = createBodeTSVContent(processed);
    }
    else {
        contents = createBodeCSVContent(processed, frequencyUnit);
    }

    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName + `.${fileExtension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    markPlotsSaved();
}

function handleCopy2clipboardBodePlotClick() {
    if (magnitudePlot.data.labels.length === 0) {
        return;
    }

    const processed = processBodeData(magnitudePlot.data.labels, magnitudePlot.data.datasets[0].data, phasePlot.data.datasets[0].data);
    const contents = createBodeTSVContent(processed);

    const icon = copy2clipboardBodePlotButton.querySelector("i");
    navigator.clipboard.writeText(contents).then(
        () => {
            markPlotsSaved();
            icon.classList.replace(clipboardClass, clipboard2checkClass);

            setTimeout(() => {
                icon.classList.replace(clipboard2checkClass, clipboardClass);
            }, 2000);
        },
        () => {
            showMessage('warn', 'Could not copy to the clipboard.');
        }
    );
}

function handleGenerateSubcktButtonClick() {
    if (magnitudePlot.data.labels.length === 0) {
        return;
    }

    let num_string = subckt_num.toString().padStart(3, '0');

    const fileName = `bode_plot_data` + num_string;
    
    const processed = processBodeData(magnitudePlot.data.labels, magnitudePlot.data.datasets[0].data, phasePlot.data.datasets[0].data);

    let contents = createLTspiceSubcktContent(processed, fileName);

    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName + '.sub';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    subckt_num = subckt_num + 1;
    markPlotsSaved();
}

function handleImportBodePlotChange(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const contents = e.target.result;
            const parsedData = parseBodePlotData(contents);
            if (parsedData.unit) {
                frequencyUnit = parsedData.unit;
                magnitudePlot.options.scales.x.title.text = `Frequency (${frequencyUnit})`;
                phasePlot.options.scales.x.title.text = `Frequency (${frequencyUnit})`;
            }
            redrawBodePlot(parsedData);
            markPlotsSaved();
        };
        reader.readAsText(file);
        event.target.value = '';    // Reset input element to allow selecting the same file again
    }
}

function handleToggleFrequencyUnitClick() {
    frequencyUnit = frequencyUnit === 'Hz' ? 'rad/s' : 'Hz';
    magnitudePlot.options.scales.x.title.text = `Frequency (${frequencyUnit})`;
    phasePlot.options.scales.x.title.text = `Frequency (${frequencyUnit})`;
    magnitudePlot.update();
    phasePlot.update();
    if (lastAnalysed) {
        showLastMeasurement(lastAnalysed);
    }
}

function handleTrimBodePlotButtonClick() {
    markPlotsChanged();
    const trimmedData = processBodeData(magnitudePlot.data.labels, magnitudePlot.data.datasets[0].data, phasePlot.data.datasets[0].data);
    redrawBodePlot(trimmedData);
}

function fetchData() {
    if (magnitudePlot.data.labels.length >= MAX_DATA_POINTS || phasePlot.data.labels.length >= MAX_DATA_POINTS) {
        if (isFetchDataInterval) {
            isFetchDataInterval = false;
            fetchButton.innerHTML = defaultFetchButtonHTML;
            autoFetchCheckbox.checked = false;
            autoFetchCheckbox.disabled = false;
            showMessage('warn', 'Maximum data points reached.', 'Auto fetch was stopped. Clear the plots to continue.');
        }
        return;
    }
    
    worker.fetch().then((result) => {
        if (!result.isSupported) {
            showMessage('err', 'This instrument is not supported.', 'Frequency response works with Tektronix and Keysight / Agilent oscilloscopes.');
            isFetchDataInterval = false;
            fetchButton.innerHTML = defaultFetchButtonHTML;
            autoFetchCheckbox.checked = false;
            autoFetchCheckbox.disabled = false;
            return;
        }

        if (isNaN(result.data_ch1[0]) || isNaN(result.data_ch2[0]) || isNaN(result.rate)) {
            if (result.reason !== 'busy') {
                const [title, body] = CAPTURE_PROBLEMS[result.reason] || ['The waveforms could not be read.', 'Check the connection and press Fetch again.'];
                showMessage('warn', title, body);
            }
        }
        else {
            // Apply low-pass filter to both waveforms
            const samplingPeriod = (1 / result.rate);
            const cutoffFreq = (result.rate / 1000);

            const ch1_result = lpf1stOrder(result.data_ch1, cutoffFreq, samplingPeriod);
            const ch2_result = lpf1stOrder(result.data_ch2, cutoffFreq, samplingPeriod);

            // Waveform Chart Data Update
            waveformChart.data.labels = Array.from({ length: ch1_result.filtered.length }, (_, i) => (i * samplingPeriod));
            waveformChart.data.datasets[0].data = ch1_result.raw
            waveformChart.data.datasets[1].data = ch1_result.filtered;
            waveformChart.data.datasets[2].data = ch2_result.raw;
            waveformChart.data.datasets[3].data = ch2_result.filtered;
            waveformChart.update();

            // Lissajous Chart Data Update
            lissajousChart.data.datasets[0].data = build_xy(ch1_result.raw, ch2_result.raw);
            lissajousChart.data.datasets[1].data = build_xy(ch1_result.filtered, ch2_result.filtered);
            lissajousChart.update();

            const analysed = findPhaseDifference(ch1_result.filtered, ch2_result.filtered, samplingPeriod);

            const problem = analysisProblem(analysed);
            if (problem) {
                showMessage('warn', problem[0], problem[1]);
            }
            else {
                clearMessages();
                showLastMeasurement(analysed);
                markPlotsChanged();
                magnitudePlot.data.labels.push(analysed.freq);
                magnitudePlot.data.datasets[0].data.push(20 * Math.log10(analysed.gain));
                magnitudePlot.update();
        
                phasePlot.data.labels.push(analysed.freq);
                phasePlot.data.datasets[0].data.push(analysed.phase_rad * 180 / Math.PI);
                phasePlot.update();
                
                if(magnitudePlot.data.labels.length > MAX_DATA_POINTS) {
                    const trimmedData = processBodeData(magnitudePlot.data.labels, magnitudePlot.data.datasets[0].data, phasePlot.data.datasets[0].data);
                    redrawBodePlot(trimmedData);
                }
        
                // Nyquist plot data update
                const realPart = analysed.gain * Math.cos(analysed.phase_rad);
                const imaginaryPart = analysed.gain * Math.sin(analysed.phase_rad);
                nyquistChart.data.datasets[0].data.push({ x: realPart, y: imaginaryPart });
                nyquistChart.data.labels.push(analysed.freq);
                updateNyquistScale(nyquistChart, 1.5);
                nyquistChart.update();
        
            }
        }

        if (!isFetchDataInterval) {
            fetchButton.innerHTML = defaultFetchButtonHTML;
        }
        else {
            let nextFetchDelay = 2 * result.length * (1 / result.rate) * 1000; // in ms
            nextFetchDelay = Math.max(nextFetchDelay , 500);
            setTimeout(fetchData, nextFetchDelay);
        }

    }).catch((error) => {
        console.error('Error during fetching waveform:', error);
        showMessage('err', 'Could not read the waveforms.', error && error.message ? error.message : String(error));
        isFetchDataInterval = false;
        fetchButton.innerHTML = defaultFetchButtonHTML;
        autoFetchCheckbox.checked = false;
        autoFetchCheckbox.disabled = false;
    });
}

function updateNyquistScale(chart, limit) {
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    chart.data.datasets[0].data.forEach(point => {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    });

    minX = Math.min(minX, -limit);
    maxX = Math.max(maxX, limit);
    minY = Math.min(minY, -limit);
    maxY = Math.max(maxY, limit);

    chart.options.scales.x.min = minX;
    chart.options.scales.x.max = maxX;
    chart.options.scales.y.min = minY;
    chart.options.scales.y.max = maxY;
}

function processBodeData(freqs, dataA, dataB) {
    const combined = freqs.map((freq, index) => ({
        freq: Math.trunc(freq),
        dataA: dataA[index],
        dataB: dataB[index]
    }));

    combined.sort((a, b) => a.freq - b.freq);

    const result = {
        frequencies: [],
        magnitudes: [],
        phases: []
    };

    let currentFreq = combined[0].freq;
    let sumDataA = 0;
    let sumDataB = 0;
    let count = 0;

    combined.forEach((item) => {
        if (Math.abs(item.freq - currentFreq) < 1) {
            sumDataA += item.dataA;
            sumDataB += item.dataB;
            count += 1;
        } else {
            result.frequencies.push(currentFreq);
            result.magnitudes.push(sumDataA / count);
            result.phases.push(sumDataB / count);

            currentFreq = item.freq;
            sumDataA = item.dataA;
            sumDataB = item.dataB;
            count = 1;
        }
    });
    result.frequencies.push(currentFreq);
    result.magnitudes.push(sumDataA / count);
    result.phases.push(sumDataB / count);

    return result;
}

function createLTspiceSubcktContent(data,file_name) {
    let contents = `.subckt ${file_name} 1 2\n`;
    contents += `E 2 0 FREQ {V(1,0)} =\n`;
    for (let i = 0; i < data.frequencies.length; i++) {
        contents += `+(${data.frequencies[i].toExponential(14)},${data.magnitudes[i].toExponential(14)},${data.phases[i].toExponential(14)})\n`;
    }
    contents += `.ends`;
    return contents;
}

function createBodeCSVContent(data, unit) {
    let csvContent = `Frequency (${unit}),Magnitude (dB),Phase (degrees)\n`;
    for (let i = 0; i < data.frequencies.length; i++) {
        const frequency = unit === 'rad/s' ? data.frequencies[i] * 2 * Math.PI : data.frequencies[i];
        csvContent += `${frequency},${data.magnitudes[i]},${data.phases[i]}\n`;
    }
    return csvContent;
}

function createBodeTSVContent(data) {
    let contents = `Frequency\tMagnitude\tPhase\n`;
    for (let i = 0; i < data.frequencies.length; i++) {
        contents += `${data.frequencies[i]}\t${data.magnitudes[i]}\t${data.phases[i]}\n`;
    }
    return contents;
}

function createCSVContent(times, a, b, c, d) {
    let csvContent = 'Time(s),Ch1_raw,Ch1_filtered,Ch2_raw,Ch2_filtered\n';
    for (let i = 0; i < times.length; i++) {
        csvContent += `${times[i]},${a[i]},${b[i]},${c[i]},${d[i]}\n`;
    }
    return csvContent;
}

function createTSVContent(times, a, b, c, d) {
    let tsvContent = 'Time\tCh1_raw\tCh1_filtered\tCh2_raw\tCh2_filtered\n';
    for (let i = 0; i < times.length; i++) {
        tsvContent += `${times[i]}\t${a[i]}\t${b[i]}\t${c[i]}\t${d[i]}\n`;
    }
    return tsvContent;
}

function setupCanvasEventListeners(canvas, ctx, chart, savedImageData, startPoint, endPoint) {
    canvas.addEventListener('mousedown', (event) => {
        const rect = event.target.getBoundingClientRect();
        isDragging = true;
        startPoint.x = event.clientX - rect.left;
        startPoint.y = event.clientY - rect.top; 
        // Initialize endpoint
        endPoint.x = startPoint.x;
        endPoint.y = startPoint.y;
        savedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    });

    canvas.addEventListener('mousemove', (event) => {
        if (isDragging) {
            const rect = event.target.getBoundingClientRect();
            endPoint.x = event.clientX - rect.left;
            endPoint.y = event.clientY - rect.top; 
            ctx.putImageData(savedImageData, 0, 0);
            drawSelectionRectangle(ctx,startPoint,endPoint);
        }
    });

    canvas.addEventListener('mouseup', (event) => {
        if (isDragging) {
            isDragging = false;
            ctx.putImageData(savedImageData, 0, 0);  // Clear the selection rectangle

            if (!enableDeleteSwitch.checked) {
                return;
            }

            const selectedPoints = getSelectedPoints(startPoint, endPoint, chart);
            removeSelectedPoints(magnitudePlot, selectedPoints);
            magnitudePlot.update();
            removeSelectedPoints(phasePlot, selectedPoints);
            phasePlot.update();
            removeSelectedPoints(nyquistChart, selectedPoints);
            nyquistChart.update();
        }
    });

    canvas.addEventListener('mouseleave', (event) => {
        if (isDragging) {
            isDragging = false;
            ctx.putImageData(savedImageData, 0, 0);  // Clear the selection rectangle
        }
    });
}

function drawSelectionRectangle(ctx, start, end) {
    ctx.strokeStyle = 'rgba(0,0,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
}

function getSelectedPoints(start, end, chart) {
    const selectedPoints = [];
    const datasets = chart.data.datasets;

    if (datasets.length >= 1) {
        datasets[0].data.forEach((dataPoint, index) => {
            const meta = chart.getDatasetMeta(0);
            const point = meta.data[index];
            const x = point.x;
            const y = point.y;

            if (x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x) &&
                y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y)) {
                selectedPoints.push(index);
            }
        });
    }

    return selectedPoints;
}

function removeSelectedPoints(chart, selectedPoints) {
    // Sort in descending order to prevent index shifting issues
    selectedPoints.sort((a, b) => b - a);
    selectedPoints.forEach(point => {
        removeDataPoint(chart, point);
    });
}

function removeDataPoint(chart, index) {
    markPlotsChanged();
    chart.data.labels.splice(index, 1);
    chart.data.datasets[0].data.splice(index, 1);
}

function getElementAtEvent(chart, event) {
    return chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
}

function handleClick(event) {
    if (!enableDeleteSwitch.checked) {
        return;
    }

    const activeElementMagnitude = getElementAtEvent(magnitudePlot, event);
    const activeElementPhase = getElementAtEvent(phasePlot, event);
    const activeElementNyquist = getElementAtEvent(nyquistChart, event);

    if (activeElementMagnitude.length > 0) {
        selectedDataPointIndex = activeElementMagnitude[0].index;
    } else if (activeElementPhase.length > 0) {
        selectedDataPointIndex = activeElementPhase[0].index;
    } else if (activeElementNyquist.length > 0) {
        selectedDataPointIndex = activeElementNyquist[0].index;
    } else {
        selectedDataPointIndex = null;
    }

    if (selectedDataPointIndex !== null) {
        removeDataPoint(magnitudePlot, selectedDataPointIndex);
        magnitudePlot.update();
        removeDataPoint(phasePlot, selectedDataPointIndex);
        phasePlot.update();
        removeDataPoint(nyquistChart, selectedDataPointIndex);
        nyquistChart.update();

    }
}

function updateChartOptionsinteraction(chart, isEnabled) {
    if(isEnabled) {
        chart.options.interaction.mode = 'nearest';
    }
    else {
        chart.options.interaction.mode = 'none';
    }
    chart.update();
}

enableDeleteSwitch.addEventListener('change', (event) => {
    const isEnabled = !enableDeleteSwitch.checked;
    updateChartOptionsinteraction(magnitudePlot, isEnabled);
    updateChartOptionsinteraction(phasePlot, isEnabled);
    updateChartOptionsinteraction(nyquistChart, isEnabled);
});

function parseBodePlotData(contents) {
    const isTSV = contents.includes('\t');
    const delimiter = isTSV ? '\t' : ',';

    const lines = contents.split('\n');
    const result = {
        frequencies: [],
        magnitudes: [],
        phases: [],
        unit: 'Hz'
    };

    if(!isTSV) {
        const header = lines[0].split(',');
        if (header[0].includes('rad/s')) {
            result.unit = 'rad/s';
        }
    }

    lines.slice(1).forEach(line => {
        const values = line.split(delimiter);
        if (values.length === 3 && !isNaN(values[0]) && !isNaN(values[1]) && !isNaN(values[2])) {
            const frequency = result.unit === 'rad/s' ? parseFloat(values[0]) / (2 * Math.PI) : parseFloat(values[0]);
            result.frequencies.push(frequency);
            result.magnitudes.push(parseFloat(values[1]));
            result.phases.push(parseFloat(values[2]));
        }
    });

    return result;
}

function redrawBodePlot(data) {
    magnitudePlot.data.labels = [...data.frequencies];
    magnitudePlot.data.datasets[0].data = [...data.magnitudes];
    magnitudePlot.update();

    phasePlot.data.labels = [...data.frequencies];
    phasePlot.data.datasets[0].data = [...data.phases];
    phasePlot.update();

    // Nyquist plot data update based on the new Bode plot data
    nyquistChart.data.labels = [...data.frequencies];
    nyquistChart.data.datasets[0].data = data.frequencies.map((freq, index) => {
        const gain = Math.pow(10, data.magnitudes[index] / 20);
        const phase_rad = data.phases[index] * Math.PI / 180;
        return { x: gain * Math.cos(phase_rad), y: gain * Math.sin(phase_rad) };
    });
    updateNyquistScale(nyquistChart, 1.5);
    nyquistChart.update();
}

function handleSpaceKeyPress(event) {
    if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        fetchButton.click();
    }
}

function toggleKeydownEvent() {
    if (enableKeydownCheckbox.checked) {
        document.addEventListener('keydown', handleSpaceKeyPress);
    } else {
        document.removeEventListener('keydown', handleSpaceKeyPress);
    }
}

// Initial setup based on checkbox state
toggleKeydownEvent();
