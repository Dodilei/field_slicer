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
    const valN = document.getElementById('val-n')!;
    const valK = document.getElementById('val-k')!;
    const valPhase = document.getElementById('val-phase')!;
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
                    controls.classList.add('active');
                    downloadBtn.disabled = false;
                    dropZone.querySelector('div:last-child')!.textContent = file.name;
                    updateSlices();
                } catch (e: any) {
                    alert('Failed to parse DXF Boundary. Is it a closed LwPolyline?');
                    console.error(e);
                }
            }
        }
    });

    const updateSlices = async () => {
        if (!originalPolygon || !wasm) return;
        valN.innerText = nSlider.value;
        valK.innerText = kSlider.value;
        valPhase.innerText = phaseSlider.value;
        
        try {
            const params = {
                n_subfields: parseInt(nSlider.value),
                k_slices: parseInt(kSlider.value),
                pizza_phase: parseFloat(phaseSlider.value)
            };
            slicedPolygons = wasm.execute_slicing(originalPolygon, params);
            draw(ctx, canvas);
        } catch (e) {
            console.error(e);
        }
    };

    nSlider.addEventListener('input', updateSlices);
    kSlider.addEventListener('input', updateSlices);
    phaseSlider.addEventListener('input', updateSlices);

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
    const w = maxX - minX;
    const h = maxY - minY;
    
    const scale = Math.min(
        (canvas.width - padding * 2) / (w || 1),
        (canvas.height - padding * 2) / (h || 1)
    );
    
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const screenCx = canvas.width / 2;
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
            ctx.fillStyle = \`hsla(\${hue}, 70%, 50%, 0.3)\`;
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
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
}
