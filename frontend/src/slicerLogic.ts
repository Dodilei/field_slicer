interface Point { x: number, y: number }
interface Polygon { exterior: Point[] }

let originalPolygon: Polygon | null = null;
let slicedPolygons: Polygon[] = [];

export async function setupLogic() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const dropZone = document.getElementById('drop-zone')!;
    const controls = document.getElementById('controls')!;
    const nSlider = document.getElementById('n-slider') as HTMLInputElement;
    const kSlider = document.getElementById('k-slider') as HTMLInputElement;
    const phaseSlider = document.getElementById('phase-slider') as HTMLInputElement;
    const axisSlider = document.getElementById('axis-slider') as HTMLInputElement;
    const snapSlider = document.getElementById('snap-slider') as HTMLInputElement;
    const centerSlider = document.getElementById('center-slider') as HTMLInputElement;
    const valN = document.getElementById('val-n')!;
    const valK = document.getElementById('val-k')!;
    const valPhase = document.getElementById('val-phase')!;
    const valAxis = document.getElementById('val-axis')!;
    const valSnap = document.getElementById('val-snap')!;
    const valCenter = document.getElementById('val-center')!;
    const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;

    let wasm: any;
    try {
        wasm = await import('core-wasm');
        if (wasm.default) { await wasm.default(); }
    } catch (e) {
        console.warn("WASM module not built yet. The backend won't work until cargo build completes.");
    }

    const resizeCanvas = () => {
        canvas.width = canvas.parentElement!.clientWidth;
        canvas.height = canvas.parentElement!.clientHeight;
        draw(ctx, canvas);
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            if (wasm) {
                try {
                    originalPolygon = wasm.parse_dxf_boundary(bytes);
                } catch (e: any) {
                    alert('Failed to parse DXF Boundary. Is it a closed LwPolyline?');
                    console.error(e);
                    return;
                }
                controls.classList.add('active');
                downloadBtn.disabled = false;
                dropZone.querySelector('div:last-child')!.textContent = file.name;
                
                // Set default center radius to 5% of subfield's equivalent radius
                const area = polyArea(originalPolygon!.exterior);
                const subfieldEqRadius = Math.sqrt((area / parseInt(nSlider.value)) / Math.PI);
                centerSlider.max = (subfieldEqRadius * 0.2).toFixed(2);
                centerSlider.step = (subfieldEqRadius * 0.005).toFixed(3);
                centerSlider.value = (subfieldEqRadius * 0.05).toFixed(2);

                try {
                    updateSlices();
                } catch (e: any) {
                    console.error('Initial slicing failed:', e);
                }
            }
        }
    });

    const updateSlices = async () => {
        valN.innerText = nSlider.value;
        valK.innerText = kSlider.value;
        valPhase.innerText = phaseSlider.value;
        valAxis.innerText = axisSlider.value + '°';
        valSnap.innerText = snapSlider.value + '%';
        valCenter.innerText = centerSlider.value + ' m';
        if (!originalPolygon || !wasm) return;
        
        const area = polyArea(originalPolygon.exterior);
        const subfieldEqRadius = Math.sqrt((area / parseInt(nSlider.value)) / Math.PI);
        
        centerSlider.max = (subfieldEqRadius * 0.2).toFixed(2);
        centerSlider.step = (subfieldEqRadius * 0.005).toFixed(3);
        
        try {
            const params = {
                n_subfields: parseInt(nSlider.value),
                k_slices: parseInt(kSlider.value),
                pizza_phase: parseFloat(phaseSlider.value),
                axis_rotation: parseFloat(axisSlider.value),
                snap_tolerance: (parseFloat(snapSlider.value) / 100.0) * subfieldEqRadius,
                center_radius: parseFloat(centerSlider.value)
            };
            slicedPolygons = wasm.execute_slicing(originalPolygon, params);
            currentN = params.n_subfields;
            currentK = params.k_slices;
            draw(ctx, canvas);
        } catch (e) {
            console.error(e);
        }
    };

    nSlider.addEventListener('input', updateSlices);
    kSlider.addEventListener('input', updateSlices);
    phaseSlider.addEventListener('input', updateSlices);
    axisSlider.addEventListener('input', updateSlices);
    snapSlider.addEventListener('input', updateSlices);
    centerSlider.addEventListener('input', updateSlices);

    downloadBtn.addEventListener('click', () => {
        if (!wasm || slicedPolygons.length === 0) return;
        try {
            const dxfBytes = wasm.export_dxf(slicedPolygons);
            const blob = new Blob([dxfBytes], { type: 'application/dxf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sliced_field.dxf';
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
        }
    });
}

let currentN = 2;
let currentK = 4;

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!originalPolygon && slicedPolygons.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const allPolys = slicedPolygons.length > 0 ? slicedPolygons : [originalPolygon!];
    
    allPolys.forEach(poly => {
        poly.exterior.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
    });

    const padding = 50;
    const sidePanelW = 240;
    const drawAreaW = canvas.width - sidePanelW; // Reserve space for right panel
    const w = maxX - minX;
    const h = maxY - minY;
    
    const scale = Math.min(
        (drawAreaW - padding * 2) / (w || 1),
        (canvas.height - padding * 2) / (h || 1)
    );
    
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const screenCx = drawAreaW / 2;
    const screenCy = canvas.height / 2;

    const toScreen = (x: number, y: number) => ({
        x: (x - cx) * scale + screenCx,
        y: -(y - cy) * scale + screenCy
    });

    if (slicedPolygons.length > 0) {
        slicedPolygons.forEach((poly, i) => {
            ctx.beginPath();
            poly.exterior.forEach((p, j) => {
                const sp = toScreen(p.x, p.y);
                if (j === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
            });
            ctx.closePath();
            
            const hue = (i * 137.5) % 360;
            ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.3)`;
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Draw area label inside each radial slice
            const area = polyArea(poly.exterior);
            const centroid = polyCentroid(poly.exterior);
            const sc = toScreen(centroid.x, centroid.y);
            const areaText = formatArea(area);
            ctx.font = '10px Outfit, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(areaText, sc.x, sc.y);
        });
    }

    if (originalPolygon) {
        ctx.beginPath();
        originalPolygon.exterior.forEach((p, j) => {
            const sp = toScreen(p.x, p.y);
            if (j === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
        });
        ctx.closePath();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Draw subfield area summary grid in the bottom-right corner
    if (slicedPolygons.length > 0 && currentK >= 1 && currentN >= 1) {
        const n = currentN;
        const k = currentK;
        
        // Group slices into subfields (every k consecutive slices = 1 subfield)
        const subfieldAreas: number[] = [];
        const sliceAreas: number[] = [];
        for (let s = 0; s < n; s++) {
            let sfArea = 0;
            for (let r = 0; r < k; r++) {
                const idx = s * k + r;
                if (idx < slicedPolygons.length) {
                    const a = polyArea(slicedPolygons[idx].exterior);
                    sfArea += a;
                    sliceAreas.push(a);
                }
            }
            subfieldAreas.push(sfArea);
        }
        
        // Calculate metrics
        let maxDeviationStr = "0.0%";
        let devColor = '#22c55e';
        if (sliceAreas.length > 0) {
            const meanArea = sliceAreas.reduce((a, b) => a + b, 0) / sliceAreas.length;
            let maxDev = 0;
            for (const a of sliceAreas) {
                const dev = Math.abs(a - meanArea) / meanArea * 100;
                if (dev > maxDev) maxDev = dev;
            }
            maxDeviationStr = maxDev.toFixed(2) + '%';
            if (maxDev > 5.0) devColor = '#ef4444';
            else if (maxDev > 1.0) devColor = '#eab308';
            else devColor = '#22c55e';
        }

        const totalSum = subfieldAreas.reduce((a, b) => a + b, 0);

        // Glitch Checking
        const originalArea = polyArea(originalPolygon!.exterior);
        let totalVoidArea = 0;
        const centerRadiusStr = (document.getElementById('center-slider') as HTMLInputElement).value;
        const centerRadius = parseFloat(centerRadiusStr);
        if (centerRadius > 0 && k > 2) {
            const voidAreaPerSubfield = (k / 2) * Math.pow(centerRadius, 2) * Math.sin((2 * Math.PI) / k);
            totalVoidArea = voidAreaPerSubfield * n;
        }
        
        const theoreticalTotal = originalArea - totalVoidArea;
        const deviationPct = Math.abs(totalSum - theoreticalTotal) / theoreticalTotal * 100;
        
        let glitchWarning = null;
        if (deviationPct > 0.5) {
            if (totalSum > theoreticalTotal) {
                glitchWarning = `⚠️ WARNING: Slices Overlap (Area Exceeds Match by ${deviationPct.toFixed(1)}%)`;
            } else {
                glitchWarning = `⚠️ WARNING: Missing Area (Slices dropped ${deviationPct.toFixed(1)}%)`;
            }
        }

        // Layout max 3 columns
        let cols = 3;
        if (n === 1) cols = 1;
        else if (n === 2 || n === 4) cols = 2;
        
        const rows = Math.ceil(n / cols);
        
        // Dimensions
        const boxW = Math.max(140, cols * 66 + 16);
        const gridH = rows * 24 + 28;
        
        // Stack layout
        const spacing = 12;
        const totalH = 46;
        const devH = 44;
        const stackHeight = totalH + spacing + devH + spacing + gridH;
        
        // Center the whole stack vertically on the right side
        const sidePanelW = 240;
        const startY = (canvas.height - stackHeight) / 2;
        const totalY = startY;
        const devY = totalY + totalH + spacing;
        const gy = devY + devH + spacing;
        
        // Center horizontally in the side panel area
        const gx = canvas.width - sidePanelW + (sidePanelW - boxW) / 2;
        
        const drawPanel = (y: number, h: number) => {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            roundRect(ctx, gx, y, boxW, h, 8);
        };
        
        // 1. Total Area Box
        drawPanel(totalY, totalH);
        ctx.font = 'bold 10px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Total Area', gx + 10, totalY + 8);
        ctx.font = 'bold 16px Outfit, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(formatArea(totalSum), gx + 10, totalY + 22);
        
        // 2. Max Deviation Box
        drawPanel(devY, devH);
        ctx.font = 'bold 10px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText('Max Deviation', gx + 10, devY + 8);
        ctx.font = 'bold 13px Outfit, sans-serif';
        ctx.fillStyle = devColor;
        ctx.fillText(maxDeviationStr, gx + 10, devY + 22);
        
        // 3. Subfield Areas Box
        drawPanel(gy, gridH);
        ctx.font = 'bold 10px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText('Subfield Areas', gx + 10, gy + 8);
        
        ctx.font = '11px Outfit, sans-serif';
        ctx.textAlign = 'center';
        const colW = (boxW - 16) / cols;
        for (let idx = 0; idx < subfieldAreas.length; idx++) {
            const col = Math.floor(idx % cols);
            const row = Math.floor(idx / cols);
            const cellX = gx + 8 + (col + 0.5) * colW;
            const cellY = gy + 26 + row * 24;
            ctx.fillStyle = `hsla(${(idx * 137.5) % 360}, 70%, 70%, 0.9)`;
            ctx.fillText(formatArea(subfieldAreas[idx]), cellX, cellY);
        }
        
        // Draw Glitch Warning Banner if necessary
        if (glitchWarning) {
            ctx.font = 'bold 14px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            const textMetrics = ctx.measureText(glitchWarning);
            const bgWidth = textMetrics.width + 32;
            const bgHeight = 32;
            const bgX = (drawAreaW - bgWidth) / 2;
            const bgY = 16;
            
            ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
            ctx.strokeStyle = 'rgba(255, 200, 200, 0.5)';
            ctx.lineWidth = 1;
            roundRect(ctx, bgX, bgY, bgWidth, bgHeight, 6);
            
            ctx.fillStyle = '#ffffff';
            ctx.fillText(glitchWarning, drawAreaW / 2, bgY + 9);
        }
    }
}

function polyArea(pts: Point[]): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
}

function polyCentroid(pts: Point[]): Point {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    const n = pts.length || 1;
    return { x: cx / n, y: cy / n };
}

function formatArea(area: number): string {
    if (area >= 10000) return (area / 10000).toPrecision(3) + ' ha';
    return area.toPrecision(3) + ' m²';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}
