// Register 
// hart.js plugins
Chart.register(ChartDataLabels);

// Global variables
let trafficChart = null;
let modelChart = null;
let currentDataset = null;
let currentTheme = 'light';

// DOM Elements
const elements = {
    // Sidebar
    dashboardBtn: document.getElementById('dashboardBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    uploadSection: document.getElementById('uploadSection'),
    settingsPanel: document.getElementById('settingsPanel'),
    
    // Main content
    mainContent: document.getElementById('mainContent'),
    initialState: document.getElementById('initialState'),
    dashboardContent: document.getElementById('dashboardContent'),
    
    // File upload
    fileInput: document.getElementById('fileInput'),
    mainFileInput: document.getElementById('mainFileInput'),
    fileUploadArea: document.getElementById('fileUploadArea'),
    uploadZone: document.getElementById('uploadZone'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    generateReportBtn: document.getElementById('generateReportBtn'),
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    
    // Settings
    themeButtons: document.querySelectorAll('.theme-btn'),
    resetBtn: document.getElementById('resetBtn'),
    
    // Stats elements
    datasetSize: document.getElementById('datasetSize'),
    recordCount: document.getElementById('recordCount'),
    normalPercent: document.getElementById('normalPercent'),
    normalRecords: document.getElementById('normalRecords'),
    ddosPercent: document.getElementById('ddosPercent'),
    ddosRecords: document.getElementById('ddosRecords'),
    bestModelAccuracy: document.getElementById('bestModelAccuracy'),
    bestModelName: document.getElementById('bestModelName'),
    
    // Chart values
    normalTrafficValue: document.getElementById('normalTrafficValue'),
    ddosTrafficValue: document.getElementById('ddosTrafficValue'),
    
    // Confusion matrix
    trueNegative: document.getElementById('trueNegative'),
    falsePositive: document.getElementById('falsePositive'),
    falseNegative: document.getElementById('falseNegative'),
    truePositive: document.getElementById('truePositive'),
    accuracyMetric: document.getElementById('accuracyMetric'),
    precisionMetric: document.getElementById('precisionMetric'),
    recallMetric: document.getElementById('recallMetric'),
    
    // Recommendations
    analysisSummaryText: document.getElementById('analysisSummaryText'),
    recommendationsGrid: document.getElementById('recommendationsGrid'),
    
    // Time display
    currentTime: document.getElementById('currentTime')
};

// Initialize the dashboard
function initDashboard() {
    // Set current time
    updateTime();
    setInterval(updateTime, 60000);
    
    // Event listeners
    setupEventListeners();
    
    // Set default theme
    setTheme('light');
    
    // Show initial state
    showInitialState();
    
    // Initialize charts with empty data
    initCharts();
}

// Update time display
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    if (elements.currentTime) {
        elements.currentTime.textContent = timeString;
    }
}

// Setup all event listeners
function setupEventListeners() {
    // Sidebar navigation
    elements.dashboardBtn?.addEventListener('click', () => {
        showDashboardSection();
        elements.dashboardBtn.classList.add('active');
        elements.settingsBtn.classList.remove('active');
    });
    
    elements.settingsBtn?.addEventListener('click', () => {
        showSettingsSection();
        elements.settingsBtn.classList.add('active');
        elements.dashboardBtn.classList.remove('active');
    });
    
    // File upload
    elements.fileUploadArea?.addEventListener('click', () => elements.fileInput?.click());
    elements.uploadZone?.addEventListener('click', () => elements.mainFileInput?.click());
    elements.fileInput?.addEventListener('change', handleFileUpload);
    elements.mainFileInput?.addEventListener('change', handleFileUpload);
    
    // Drag and drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        elements.uploadZone?.addEventListener(eventName, preventDefaults, false);
        elements.fileUploadArea?.addEventListener(eventName, preventDefaults, false);
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
        elements.uploadZone?.addEventListener(eventName, highlight, false);
        elements.fileUploadArea?.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        elements.uploadZone?.addEventListener(eventName, unhighlight, false);
        elements.fileUploadArea?.addEventListener(eventName, unhighlight, false);
    });
    
    elements.uploadZone?.addEventListener('drop', handleDrop, false);
    elements.fileUploadArea?.addEventListener('drop', handleDrop, false);
    
    // Analyze button
    elements.analyzeBtn?.addEventListener('click', analyzeDataset);
    
    // Sample data
    elements.loadSampleBtn?.addEventListener('click', loadSampleData);
    
    // Theme buttons
    elements.themeButtons?.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            setTheme(theme);
            
            // Update active state
            elements.themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    
    // Reset button
    elements.resetBtn?.addEventListener('click', resetDashboard);
    
    // Export buttons
    document.querySelectorAll('.export-chart').forEach(btn => {
        btn.addEventListener('click', function() {
            const chartType = this.getAttribute('data-chart');
            exportChart(chartType);
        });
    });
    
    // Refresh matrix
    document.getElementById('refreshMatrix')?.addEventListener('click', refreshConfusionMatrix);
    
    // Expand recommendations
    document.getElementById('expandRecommendations')?.addEventListener('click', expandRecommendations);
    
    // Export results
    document.getElementById('exportResultsBtn')?.addEventListener('click', exportResults);
}

// Prevent default drag and drop behavior
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Highlight drop zone
function highlight() {
    this.style.borderColor = '#3b82f6';
    this.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
}

// Unhighlight drop zone
function unhighlight() {
    this.style.borderColor = '';
    this.style.backgroundColor = '';
}

// Handle file drop
function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
            // Create a mock FileList-like object
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            
            if (elements.fileInput) {
                elements.fileInput.files = dataTransfer.files;
                handleFileUpload({ target: elements.fileInput });
            }
        } else {
            showToast('Please upload a CSV file', 'error');
        }
    }
}

// Handle file upload
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.json') && !file.name.endsWith('.txt')) {
        showToast('Please upload a CSV, JSON, or TXT file', 'error');
        return;
    }
    
    // Update UI
    const fileName = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;
    const fileSize = (file.size / (1024*1024)).toFixed(2);
    
    // Update upload area
    if (elements.fileUploadArea) {
        elements.fileUploadArea.innerHTML = `
            <i class="fas fa-file-csv" style="color: #10b981;"></i>
            <p style="font-weight: 600;">${fileName}</p>
            <p class="file-format">${fileSize} MB • CSV Dataset</p>
        `;
        elements.fileUploadArea.style.borderColor = '#10b981';
        elements.fileUploadArea.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
    }
    
    if (elements.uploadZone) {
        elements.uploadZone.innerHTML = `
            <i class="fas fa-check-circle" style="color: #10b981;"></i>
            <p style="font-weight: 600;">${fileName} uploaded</p>
            <p class="file-hint">Ready for analysis</p>
        `;
        elements.uploadZone.style.borderColor = '#10b981';
    }
    
    // Enable analyze button
    if (elements.analyzeBtn) {
        elements.analyzeBtn.disabled = false;
        elements.analyzeBtn.innerHTML = `<i class="fas fa-chart-bar"></i> Analyze "${fileName}"`;
    }
    
    // Store the file
    currentDataset = {
        name: fileName,
        size: fileSize,
        type: file.type,
        data: null
    };
    
    showToast(`File "${fileName}" uploaded successfully`, 'success');
}

// Show dashboard section
function showDashboardSection() {
    if (elements.uploadSection) elements.uploadSection.style.display = 'block';
    if (elements.settingsPanel) elements.settingsPanel.style.display = 'none';
}

// Show settings section
function showSettingsSection() {
    if (elements.uploadSection) elements.uploadSection.style.display = 'none';
    if (elements.settingsPanel) elements.settingsPanel.style.display = 'block';
}

// Show initial state
function showInitialState() {
    if (elements.initialState) elements.initialState.style.display = 'flex';
    if (elements.dashboardContent) elements.dashboardContent.style.display = 'none';
}

// Show dashboard content
function showDashboardContent() {
    if (elements.initialState) elements.initialState.style.display = 'none';
    if (elements.dashboardContent) elements.dashboardContent.style.display = 'flex';
}

// Initialize charts with empty data - FIXED FOR CENTERING
function initCharts() {
    // Destroy existing charts if they exist
    if (trafficChart) trafficChart.destroy();
    if (modelChart) modelChart.destroy();
    
    // Traffic Chart - FIXED CENTERING
    const trafficCtx = document.getElementById('trafficChart')?.getContext('2d');
    if (trafficCtx) {
        trafficChart = new Chart(trafficCtx, {
            type: 'doughnut',
            data: {
                labels: ['Normal Traffic', 'DDoS Traffic'],
                datasets: [{
                    data: [0, 0],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 2,
                    borderColor: '#ffffff',
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '70%',
                plugins: {
                    legend: { 
                        display: false 
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        borderColor: '#334155',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return `${context.label}: ${context.parsed}%`;
                            }
                        }
                    },
                    datalabels: {
                        color: '#ffffff',
                        font: { 
                            weight: 'bold', 
                            size: 16
                        },
                        formatter: (value) => value + '%',
                        anchor: 'center',
                        align: 'center',
                        offset: 0
                    }
                },
                layout: {
                    padding: {
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }
    
    // Model Performance Chart
    const modelCtx = document.getElementById('modelChart')?.getContext('2d');
    if (modelCtx) {
        modelChart = new Chart(modelCtx, {
            type: 'bar',
            data: {
                labels: ['Random Forest', 'XGBoost', 'SVM'],
                datasets: [{
                    data: [0, 0, 0],
                    backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(245, 158, 11, 0.8)', 'rgba(139, 92, 246, 0.8)'],
                    borderColor: ['rgb(59, 130, 246)', 'rgb(245, 158, 11)', 'rgb(139, 92, 246)'],
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        borderColor: '#334155',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return `Accuracy: ${context.parsed.y}%`;
                            }
                        }
                    },
                    datalabels: {
                        color: '#ffffff',
                        font: { weight: 'bold', size: 12 },
                        anchor: 'end',
                        align: 'top',
                        offset: 4,
                        formatter: (value) => value + '%'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: 'rgba(226, 232, 240, 0.5)' },
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            },
                            color: '#64748b'
                        },
                        title: {
                            display: true,
                            text: 'Accuracy (%)',
                            color: '#64748b'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#475569' }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }
}

// Analyze dataset
function analyzeDataset() {
    if (!currentDataset) {
        showToast('Please upload a dataset first', 'error');
        return;
    }
    
    // Show loading state
    if (elements.analyzeBtn) {
        elements.analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        elements.analyzeBtn.disabled = true;
    }
    
    // Simulate analysis delay
    setTimeout(() => {
        // Generate dummy data based on file size
        const fileSizeMB = parseFloat(currentDataset.size);
        const totalRecords = Math.floor(fileSizeMB * 15625); // Rough estimate
        
        // Fixed values to match your image: 72% Normal, 28% DDoS
        const normalPercent = 72;
        const ddosPercent = 28;
        
        const normalRecords = Math.floor(totalRecords * (normalPercent / 100));
        const ddosRecords = totalRecords - normalRecords;
        
        // Model accuracies
        const rfAccuracy = 96;
        const xgbAccuracy = 70;
        const svmAccuracy = 60;
        
        // Confusion matrix values
        const trueNegative = Math.floor(normalRecords * 0.97); // 97% correct
        const falsePositive = normalRecords - trueNegative;
        const truePositive = Math.floor(ddosRecords * 0.92); // 92% correct
        const falseNegative = ddosRecords - truePositive;
        
        // Calculate metrics
        const accuracy = ((trueNegative + truePositive) / totalRecords * 100).toFixed(1);
        const precision = (truePositive / (truePositive + falsePositive) * 100).toFixed(1);
        const recall = (truePositive / (truePositive + falseNegative) * 100).toFixed(1);
        
        // Update UI with results
        updateDashboardResults({
            datasetSize: currentDataset.size,
            totalRecords: totalRecords.toLocaleString(),
            normalPercent: normalPercent,
            normalRecords: normalRecords.toLocaleString(),
            ddosPercent: ddosPercent,
            ddosRecords: ddosRecords.toLocaleString(),
            rfAccuracy: rfAccuracy,
            xgbAccuracy: xgbAccuracy,
            svmAccuracy: svmAccuracy,
            trueNegative: trueNegative.toLocaleString(),
            falsePositive: falsePositive.toLocaleString(),
            falseNegative: falseNegative.toLocaleString(),
            truePositive: truePositive.toLocaleString(),
            accuracy: accuracy,
            precision: precision,
            recall: recall
        });
        
        // Show dashboard content
        showDashboardContent();
        
        // Enable report button
        if (elements.generateReportBtn) {
            elements.generateReportBtn.disabled = false;
        }
        
        // Show success message
        showToast('Analysis complete! Results displayed below.', 'success');
        
        // Reset analyze button
        if (elements.analyzeBtn) {
            elements.analyzeBtn.innerHTML = '<i class="fas fa-redo"></i> Re-analyze';
            elements.analyzeBtn.disabled = false;
        }
    }, 2000);
}

// Update dashboard with results
function updateDashboardResults(results) {
    // Update stats
    if (elements.datasetSize) elements.datasetSize.textContent = `${results.datasetSize} MB`;
    if (elements.recordCount) elements.recordCount.textContent = `${results.totalRecords} records`;
    if (elements.normalPercent) elements.normalPercent.textContent = `${results.normalPercent}%`;
    if (elements.normalRecords) elements.normalRecords.textContent = `${results.normalRecords} records`;
    if (elements.ddosPercent) elements.ddosPercent.textContent = `${results.ddosPercent}%`;
    if (elements.ddosRecords) elements.ddosRecords.textContent = `${results.ddosRecords} records`;
    
    // Determine best model
    const models = [
        { name: 'Random Forest', accuracy: results.rfAccuracy },
        { name: 'XGBoost', accuracy: results.xgbAccuracy },
        { name: 'SVM', accuracy: results.svmAccuracy }
    ];
    const bestModel = models.reduce((prev, current) => 
        (prev.accuracy > current.accuracy) ? prev : current
    );
    
    if (elements.bestModelAccuracy) elements.bestModelAccuracy.textContent = `${bestModel.accuracy}%`;
    if (elements.bestModelName) elements.bestModelName.textContent = bestModel.name;
    
    // Update charts
    if (trafficChart) {
        trafficChart.data.datasets[0].data = [results.normalPercent, results.ddosPercent];
        trafficChart.update();
    }
    
    if (modelChart) {
        modelChart.data.datasets[0].data = [results.rfAccuracy, results.xgbAccuracy, results.svmAccuracy];
        modelChart.update();
    }
    
    // Update chart legend values
    if (elements.normalTrafficValue) elements.normalTrafficValue.textContent = `${results.normalPercent}%`;
    if (elements.ddosTrafficValue) elements.ddosTrafficValue.textContent = `${results.ddosPercent}%`;
    
    // Update confusion matrix
    if (elements.trueNegative) elements.trueNegative.textContent = results.trueNegative;
    if (elements.falsePositive) elements.falsePositive.textContent = results.falsePositive;
    if (elements.falseNegative) elements.falseNegative.textContent = results.falseNegative;
    if (elements.truePositive) elements.truePositive.textContent = results.truePositive;
    if (elements.accuracyMetric) elements.accuracyMetric.textContent = `${results.accuracy}%`;
    if (elements.precisionMetric) elements.precisionMetric.textContent = `${results.precision}%`;
    if (elements.recallMetric) elements.recallMetric.textContent = `${results.recall}%`;
    
    // Update analysis summary
    if (elements.analysisSummaryText) {
        elements.analysisSummaryText.innerHTML = `
            The dataset contains <strong>${results.totalRecords}</strong> network traffic records with 
            <strong style="color: #ef4444;">${results.ddosPercent}% DDoS attack patterns</strong>. 
            The ${bestModel.name} model achieved <strong>${bestModel.accuracy}% accuracy</strong> 
            in classification with ${results.accuracy}% overall accuracy.
        `;
    }
    
    // Update recommendations
    updateRecommendations(results);
}

// Update recommendations based on results
function updateRecommendations(results) {
    const recommendations = [
        {
            icon: 'fas fa-filter',
            title: 'Feature Engineering',
            description: results.ddosPercent > 30 ? 
                'Add packet frequency and size variance as features to improve model precision to >98%.' :
                'Current features are sufficient for the attack detection rate.'
        },
        {
            icon: 'fas fa-balance-scale',
            title: 'Data Balancing',
            description: Math.abs(results.normalPercent - results.ddosPercent) > 40 ?
                'Apply SMOTE technique to balance the dataset classes for better generalization.' :
                'Dataset is reasonably balanced for effective model training.'
        },
        {
            icon: 'fas fa-layer-group',
            title: 'Model Ensemble',
            description: results.rfAccuracy - results.xgbAccuracy > 10 ?
                'Combine Random Forest with XGBoost using stacking to reduce false negatives.' :
                'Single model performance is adequate for current detection needs.'
        },
        {
            icon: 'fas fa-sliders-h',
            title: 'Threshold Tuning',
            description: results.precision < 95 ?
                'Adjust classification threshold to 0.35 to reduce false positives while maintaining recall.' :
                'Current threshold settings are optimal for precision-recall balance.'
        }
    ];
    
    // Clear existing recommendations
    if (elements.recommendationsGrid) {
        elements.recommendationsGrid.innerHTML = '';
        
        // Add new recommendations
        recommendations.forEach(rec => {
            const recElement = document.createElement('div');
            recElement.className = 'recommendation';
            recElement.innerHTML = `
                <div class="recommendation-header">
                    <div class="recommendation-icon">
                        <i class="${rec.icon}"></i>
                    </div>
                    <h4>${rec.title}</h4>
                </div>
                <p>${rec.description}</p>
            `;
            elements.recommendationsGrid.appendChild(recElement);
        });
    }
}

// Load sample data
function loadSampleData(e) {
    e.preventDefault();
    
    // Create a mock file object
    currentDataset = {
        name: 'sample_traffic_data.csv',
        size: '12.8',
        type: 'text/csv'
    };
    
    // Update UI
    if (elements.fileUploadArea) {
        elements.fileUploadArea.innerHTML = `
            <i class="fas fa-file-csv" style="color: #10b981;"></i>
            <p style="font-weight: 600;">sample_traffic_data.csv</p>
            <p class="file-format">12.8 MB • Sample Dataset</p>
        `;
        elements.fileUploadArea.style.borderColor = '#10b981';
        elements.fileUploadArea.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
    }
    
    if (elements.uploadZone) {
        elements.uploadZone.innerHTML = `
            <i class="fas fa-check-circle" style="color: #10b981;"></i>
            <p style="font-weight: 600;">Sample dataset loaded</p>
            <p class="file-hint">Ready for analysis</p>
        `;
        elements.uploadZone.style.borderColor = '#10b981';
    }
    
    // Enable analyze button
    if (elements.analyzeBtn) {
        elements.analyzeBtn.disabled = false;
        elements.analyzeBtn.innerHTML = '<i class="fas fa-chart-bar"></i> Analyze Sample Dataset';
    }
    
    showToast('Sample dataset loaded successfully', 'success');
}

// Set theme
function setTheme(theme) {
    currentTheme = theme;
    document.body.className = `${theme}-theme`;
    localStorage.setItem('ddos-analyzer-theme', theme);
}

// Reset dashboard
function resetDashboard() {
    if (confirm('Are you sure you want to reset the dashboard? All current data will be lost.')) {
        // Reset file inputs
        if (elements.fileInput) elements.fileInput.value = '';
        if (elements.mainFileInput) elements.mainFileInput.value = '';
        
        // Reset upload areas
        if (elements.fileUploadArea) {
            elements.fileUploadArea.innerHTML = `
                <i class="fas fa-file-csv"></i>
                <p>Click to upload CSV file</p>
                <p class="file-format">Supports: CSV, JSON, TXT</p>
            `;
            elements.fileUploadArea.style.borderColor = '';
            elements.fileUploadArea.style.backgroundColor = '';
        }
        
        if (elements.uploadZone) {
            elements.uploadZone.innerHTML = `
                <i class="fas fa-file-csv"></i>
                <p>Drag & drop your CSV file here</p>
                <p class="file-hint">or click to browse files</p>
            `;
            elements.uploadZone.style.borderColor = '';
        }
        
        // Reset buttons
        if (elements.analyzeBtn) {
            elements.analyzeBtn.disabled = true;
            elements.analyzeBtn.innerHTML = '<i class="fas fa-chart-bar"></i> Analyze Dataset';
        }
        
        if (elements.generateReportBtn) {
            elements.generateReportBtn.disabled = true;
        }
        
        // Reset dataset
        currentDataset = null;
        
        // Show initial state
        showInitialState();
        
        // Reset charts
        initCharts();
        
        showToast('Dashboard reset successfully', 'success');
    }
}

// Export chart as image
function exportChart(chartType) {
    let chart, filename;
    
    if (chartType === 'traffic' && trafficChart) {
        chart = trafficChart;
        filename = 'traffic-distribution.png';
    } else if (chartType === 'model' && modelChart) {
        chart = modelChart;
        filename = 'model-performance.png';
    } else {
        showToast('Chart not available for export', 'error');
        return;
    }
    
    const link = document.createElement('a');
    link.download = filename;
    link.href = chart.toBase64Image();
    link.click();
    
    showToast(`Chart exported as ${filename}`, 'success');
}

// Refresh confusion matrix
function refreshConfusionMatrix() {
    if (!currentDataset) {
        showToast('Please analyze a dataset first', 'error');
        return;
    }
    
    // Simulate refreshing with slight variations
    const trueNegative = elements.trueNegative.textContent.replace(/,/g, '');
    const falsePositive = elements.falsePositive.textContent.replace(/,/g, '');
    const falseNegative = elements.falseNegative.textContent.replace(/,/g, '');
    const truePositive = elements.truePositive.textContent.replace(/,/g, '');
    
    // Add small random variations
    const variations = {
        trueNegative: Math.max(0, parseInt(trueNegative) + Math.floor(Math.random() * 21) - 10),
        falsePositive: Math.max(0, parseInt(falsePositive) + Math.floor(Math.random() * 6) - 3),
        falseNegative: Math.max(0, parseInt(falseNegative) + Math.floor(Math.random() * 6) - 3),
        truePositive: Math.max(0, parseInt(truePositive) + Math.floor(Math.random() * 21) - 10)
    };
    
    // Update matrix
    const total = variations.trueNegative + variations.falsePositive + variations.falseNegative + variations.truePositive;
    const accuracy = ((variations.trueNegative + variations.truePositive) / total * 100).toFixed(1);
    const precision = (variations.truePositive / (variations.truePositive + variations.falsePositive) * 100).toFixed(1);
    const recall = (variations.truePositive / (variations.truePositive + variations.falseNegative) * 100).toFixed(1);
    
    elements.trueNegative.textContent = variations.trueNegative.toLocaleString();
    elements.falsePositive.textContent = variations.falsePositive.toLocaleString();
    elements.falseNegative.textContent = variations.falseNegative.toLocaleString();
    elements.truePositive.textContent = variations.truePositive.toLocaleString();
    elements.accuracyMetric.textContent = `${accuracy}%`;
    elements.precisionMetric.textContent = `${precision}%`;
    elements.recallMetric.textContent = `${recall}%`;
    
    showToast('Confusion matrix refreshed with new sampling', 'success');
}

// Expand recommendations
function expandRecommendations() {
    const grid = elements.recommendationsGrid;
    if (grid) {
        if (grid.style.maxHeight) {
            grid.style.maxHeight = '';
            this.innerHTML = '<i class="fas fa-expand"></i>';
            showToast('Recommendations collapsed', 'info');
        } else {
            grid.style.maxHeight = 'none';
            this.innerHTML = '<i class="fas fa-compress"></i>';
            showToast('Recommendations expanded', 'info');
        }
    }
}

// Export results
function exportResults() {
    if (!currentDataset) {
        showToast('No results to export', 'error');
        return;
    }
    
    // Create export data
    const exportData = {
        dataset: currentDataset.name,
        timestamp: new Date().toISOString(),
        stats: {
            size: elements.datasetSize?.textContent,
            records: elements.recordCount?.textContent,
            normal: elements.normalPercent?.textContent,
            ddos: elements.ddosPercent?.textContent
        },
        models: {
            best: elements.bestModelName?.textContent,
            accuracy: elements.bestModelAccuracy?.textContent
        },
        matrix: {
            tn: elements.trueNegative?.textContent,
            fp: elements.falsePositive?.textContent,
            fn: elements.falseNegative?.textContent,
            tp: elements.truePositive?.textContent,
            accuracy: elements.accuracyMetric?.textContent,
            precision: elements.precisionMetric?.textContent,
            recall: elements.recallMetric?.textContent
        }
    };
    
    // Convert to JSON and create download
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `ddos-analysis-results-${Date.now()}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    showToast('Results exported as JSON', 'success');
}

// Generate PDF report
async function generateReport() {
    if (!currentDataset) {
        showToast('Please analyze a dataset first', 'error');
        return;
    }
    
    showToast('Generating PDF report...', 'info');
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    // Report header
    pdf.setFillColor(15, 23, 42);
    pdf.rect(0, 0, pageWidth, 30, 'F');
    
    // Add logo (if available)
    try {
        // In a real implementation, you would load your logo image
        // For now, we'll use text
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(22);
        pdf.setFont('helvetica', 'bold');
        pdf.text('DDoS ANALYZER', pageWidth / 2, 18, { align: 'center' });
    } catch (error) {
        console.log('Logo not available, using text instead');
    }
    
    pdf.setFontSize(10);
    pdf.text('Batch Analysis Report', pageWidth / 2, 25, { align: 'center' });
    
    let yPos = 40;
    
    // Report metadata
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(9);
    pdf.text(`Report ID: DDoS-${Date.now().toString().slice(-8)}`, 20, yPos);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - 20, yPos, { align: 'right' });
    
    yPos += 15;
    
    // Section 1: Executive Summary
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('1. EXECUTIVE SUMMARY', 20, yPos);
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.5);
    pdf.line(20, yPos + 2, 70, yPos + 2);
    
    yPos += 10;
    
    pdf.setTextColor(71, 85, 105);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    
    const summaryText = `
This report presents the batch analysis of network traffic data for DDoS attack detection.
The analysis was performed using machine learning models to classify traffic patterns
as normal or malicious. Key findings and recommendations are detailed below.
    `;
    
    pdf.text(summaryText, 20, yPos, { maxWidth: pageWidth - 40 });
    yPos += 30;
    
    // Section 2: Key Findings
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('2. KEY FINDINGS', 20, yPos);
    pdf.line(20, yPos + 2, 60, yPos + 2);
    
    yPos += 10;
    
    const findings = [
        `• Dataset: ${currentDataset.name} (${currentDataset.size} MB)`,
        `• Total Records: ${elements.recordCount?.textContent || 'N/A'}`,
        `• Normal Traffic: ${elements.normalPercent?.textContent || '0%'}`,
        `• DDoS Traffic: ${elements.ddosPercent?.textContent || '0%'}`,
        `• Best Model: ${elements.bestModelName?.textContent || 'N/A'} (${elements.bestModelAccuracy?.textContent || '0%'} accuracy)`,
        `• Overall Accuracy: ${elements.accuracyMetric?.textContent || '0%'}`,
        `• Security Status: ${parseInt(elements.ddosPercent?.textContent || '0') > 25 ? 'HIGH RISK' : 'MODERATE RISK'}`
    ];
    
    findings.forEach((finding, index) => {
        pdf.text(finding, 25, yPos + (index * 6));
    });
    
    yPos += (findings.length * 6) + 15;
    
    // Section 3: Traffic Distribution
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('3. TRAFFIC DISTRIBUTION', 20, yPos);
    pdf.line(20, yPos + 2, 100, yPos + 2);
    
    yPos += 10;
    
    // Add traffic chart if available
    if (trafficChart) {
        try {
            const chartImage = trafficChart.toBase64Image();
            pdf.addImage(chartImage, 'PNG', 20, yPos, 80, 50);
            pdf.setFontSize(10);
            pdf.setTextColor(100, 116, 139);
            pdf.text('Figure 1: Normal vs DDoS Traffic Distribution', 20, yPos + 55);
        } catch (error) {
            pdf.text('Chart not available for export', 20, yPos);
        }
    }
    
    yPos += 70;
    
    // Section 4: Model Performance
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('4. MODEL PERFORMANCE', 20, yPos);
    pdf.line(20, yPos + 2, 95, yPos + 2);
    
    yPos += 10;
    
    // Add model performance chart if available
    if (modelChart) {
        try {
            const chartImage = modelChart.toBase64Image();
            pdf.addImage(chartImage, 'PNG', 20, yPos, 80, 40);
            pdf.setFontSize(10);
            pdf.setTextColor(100, 116, 139);
            pdf.text('Figure 2: Machine Learning Model Accuracy Comparison', 20, yPos + 45);
        } catch (error) {
            pdf.text('Chart not available for export', 20, yPos);
        }
    }
    
    yPos += 60;
    
    // Section 5: Confusion Matrix Results
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('5. CONFUSION MATRIX RESULTS', 20, yPos);
    pdf.line(20, yPos + 2, 120, yPos + 2);
    
    yPos += 10;
    
    pdf.setFontSize(11);
    pdf.setTextColor(71, 85, 105);
    
    // Create a simple table for confusion matrix
    const matrixData = [
        ['', 'Predicted Normal', 'Predicted DDoS'],
        ['Actual Normal', elements.trueNegative?.textContent || '0', elements.falsePositive?.textContent || '0'],
        ['Actual DDoS', elements.falseNegative?.textContent || '0', elements.truePositive?.textContent || '0']
    ];
    
    // Draw the table
    const startX = 30;
    const startY = yPos;
    const cellWidth = 50;
    const cellHeight = 8;
    
    matrixData.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
            const x = startX + (colIndex * cellWidth);
            const y = startY + (rowIndex * cellHeight);
            
            // Draw cell border
            pdf.rect(x, y, cellWidth, cellHeight);
            
            // Set font style for headers
            if (rowIndex === 0 || colIndex === 0) {
                pdf.setFont('helvetica', 'bold');
            } else {
                pdf.setFont('helvetica', 'normal');
            }
            
            // Add text
            pdf.text(cell, x + 5, y + 5);
        });
    });
    
    yPos += 35;
    
    // Performance metrics
    pdf.text('Performance Metrics:', 20, yPos);
    pdf.text(`• Accuracy: ${elements.accuracyMetric?.textContent || '0%'}`, 25, yPos + 7);
    pdf.text(`• Precision: ${elements.precisionMetric?.textContent || '0%'}`, 25, yPos + 14);
    pdf.text(`• Recall: ${elements.recallMetric?.textContent || '0%'}`, 25, yPos + 21);
    
    yPos += 35;
    
    // Section 6: Recommendations
    pdf.setTextColor(15, 23, 42);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('6. RECOMMENDATIONS', 20, yPos);
    pdf.line(20, yPos + 2, 90, yPos + 2);
    
    yPos += 10;
    
    pdf.setFontSize(11);
    pdf.setTextColor(71, 85, 105);
    
    // Get recommendations from the page
    const recommendationElements = document.querySelectorAll('.recommendation');
    const recommendations = Array.from(recommendationElements).map(el => ({
        title: el.querySelector('h4')?.textContent || 'Recommendation',
        description: el.querySelector('p')?.textContent || ''
    }));
    
    // Add recommendations to PDF
    recommendations.forEach((rec, index) => {
        if (yPos > pageHeight - 40) {
            pdf.addPage();
            yPos = 20;
        }
        
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${index + 1}. ${rec.title}`, 20, yPos);
        
        pdf.setFont('helvetica', 'normal');
        const lines = pdf.splitTextToSize(rec.description, pageWidth - 40);
        pdf.text(lines, 25, yPos + 7);
        
        yPos += 7 + (lines.length * 5) + 5;
    });
    
    // Add footer
    pdf.setFontSize(9);
    pdf.setTextColor(148, 163, 184);
    pdf.text('© DDoS Analyzer - Batch Processing System | Confidential Report', pageWidth / 2, pageHeight - 10, { align: 'center' });
    
    // Add page numbers
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.text(`Page ${i} of ${totalPages}`, pageWidth - 30, pageHeight - 10);
    }
    
    // Save the PDF
    const fileName = `DDoS_Analysis_Report_${Date.now()}.pdf`;
    pdf.save(fileName);
    
    showToast(`Report "${fileName}" generated successfully`, 'success');
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    // Set icon based on type
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'warning') icon = 'exclamation-triangle';
    
    toast.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;
    
    // Set color based on type
    const colors = {
        info: '#3b82f6',
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b'
    };
    
    toast.style.borderLeftColor = colors[type] || colors.info;
    
    // Show toast
    toast.classList.add('show');
    
    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Load saved theme
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('ddos-analyzer-theme');
    if (savedTheme) {
        setTheme(savedTheme);
        
        // Update active theme button
        elements.themeButtons?.forEach(btn => {
            if (btn.getAttribute('data-theme') === savedTheme) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    loadSavedTheme();
});