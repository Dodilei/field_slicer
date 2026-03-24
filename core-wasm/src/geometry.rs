use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WasmPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WasmPolygon {
    pub exterior: Vec<WasmPoint>,
}
