import '../style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="sidebar">
    <h1>Slicer X</h1>
    <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: -1rem;">Advanced Boundary Geometry</p>
    
    <div class="upload-area" id="drop-zone">
      <div>📁</div>
      <div>Click or drag DXF file here</div>
      <input type="file" id="file-input" accept=".dxf" />
    </div>

    <div class="control-group" id="controls">
      <div class="control-header">
        <span>Subfields (N)</span>
        <span class="val-display" id="val-n">2</span>
      </div>
      <input type="range" id="n-slider" min="2" max="32" step="2" value="2" />

      <div class="control-header">
        <span>Radial Slices (K)</span>
        <span class="val-display" id="val-k">4</span>
      </div>
      <input type="range" id="k-slider" min="1" max="16" step="1" value="4" />

      <div class="control-header">
        <span>Axis Rotation (°)</span>
        <span class="val-display" id="val-axis">0</span>
      </div>
      <input type="range" id="axis-slider" min="0" max="180" step="1" value="0" />

      <div class="control-header">
        <span>Phase Alignment</span>
        <span class="val-display" id="val-phase">0.0</span>
      </div>
      <input type="range" id="phase-slider" min="0" max="1" step="0.01" value="0" />

      <div class="control-header">
        <span>Snap Tolerance</span>
        <span class="val-display" id="val-snap">1.0</span>
      </div>
      <input type="range" id="snap-slider" min="0" max="10" step="0.1" value="1" />
    </div>

    <button class="primary" id="download-btn" disabled>Export Output DXF</button>
  </div>
  <div class="canvas-container">
    <canvas id="canvas"></canvas>
  </div>
`;

import { setupLogic } from './slicerLogic';
setupLogic();
