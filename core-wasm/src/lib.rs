pub mod geometry;
pub mod dxf_util;
pub mod slicing;

use wasm_bindgen::prelude::*;
use serde::Deserialize;
use serde_wasm_bindgen::to_value;

#[derive(Deserialize)]
pub struct SlicerParams {
    pub n_subfields: usize,
    pub k_slices: usize,
    pub pizza_phase: f64,
    pub axis_rotation: f64,
    pub snap_tolerance: f64,
}

#[wasm_bindgen]
pub fn execute_slicing(polygon_js: JsValue, params_js: JsValue) -> Result<JsValue, JsValue> {
    let polygon: geometry::WasmPolygon = serde_wasm_bindgen::from_value(polygon_js)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let params: SlicerParams = serde_wasm_bindgen::from_value(params_js)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
    let result = slicing::slice(&polygon, params.n_subfields, params.k_slices, params.pizza_phase, params.axis_rotation, params.snap_tolerance)
        .map_err(|e| JsValue::from_str(&e))?;
        
    to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn parse_dxf_boundary(data: &[u8]) -> Result<JsValue, JsValue> {
    match dxf_util::extract_boundary(data) {
        Ok(poly) => to_value(&poly).map_err(|e| JsValue::from_str(&e.to_string())),
        Err(e) => Err(JsValue::from_str(&e)),
    }
}

#[wasm_bindgen]
pub fn export_dxf(polygons_js: JsValue) -> Result<Vec<u8>, JsValue> {
    let polygons: Vec<geometry::WasmPolygon> = serde_wasm_bindgen::from_value(polygons_js)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
    dxf_util::generate_dxf_bytes(&polygons).map_err(|e| JsValue::from_str(&e))
}

