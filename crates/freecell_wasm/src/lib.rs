use freecell_engine::{Action, AutoPlayPolicy, Game, HintOptions, decode_action};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmGame {
    inner: Game,
}

#[wasm_bindgen]
impl WasmGame {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Self {
        Self {
            inner: Game::new(seed),
        }
    }

    #[wasm_bindgen(js_name = withPolicy)]
    pub fn with_policy(seed: u32, auto_play_policy: &str) -> Result<WasmGame, JsValue> {
        Ok(Self {
            inner: Game::with_policy(seed, parse_policy(auto_play_policy)?),
        })
    }

    pub fn reset(&mut self, seed: u32) -> Result<JsValue, JsValue> {
        self.inner.reset(seed);
        self.get_state()
    }

    #[wasm_bindgen(js_name = getState)]
    pub fn get_state(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.snapshot()).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = legalActions)]
    pub fn legal_actions(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.legal_actions()).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = legalActionMask)]
    pub fn legal_action_mask(&self) -> Vec<u8> {
        self.inner.legal_action_mask()
    }

    pub fn hint(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.hint()).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = hintWithOptions)]
    pub fn hint_with_options(&self, max_depth: u8, max_nodes: u32) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.hint_with_options(HintOptions {
            max_depth,
            max_nodes,
        }))
        .map_err(to_js_error)
    }

    pub fn step(&mut self, action_index: u16) -> Result<JsValue, JsValue> {
        let action = decode_action(action_index)
            .ok_or_else(|| JsValue::from_str("action index is out of range"))?;
        serde_wasm_bindgen::to_value(&self.inner.step(action)).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = stepAction)]
    pub fn step_action(&mut self, action: JsValue) -> Result<JsValue, JsValue> {
        let action: Action = serde_wasm_bindgen::from_value(action).map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&self.inner.step(action)).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = runAutoPlay)]
    pub fn run_auto_play(&mut self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.run_auto_play()).map_err(to_js_error)
    }

    pub fn undo(&mut self) -> Result<JsValue, JsValue> {
        let _ = self.inner.undo();
        self.get_state()
    }

    pub fn redo(&mut self) -> Result<JsValue, JsValue> {
        let _ = self.inner.redo();
        self.get_state()
    }

    #[wasm_bindgen(js_name = setAutoPlayPolicy)]
    pub fn set_auto_play_policy(&mut self, auto_play_policy: &str) -> Result<(), JsValue> {
        self.inner
            .set_auto_play_policy(parse_policy(auto_play_policy)?);
        Ok(())
    }

    #[wasm_bindgen(js_name = exportReplay)]
    pub fn export_replay(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.replay_export()).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = snapshotJson)]
    pub fn snapshot_json(&self) -> String {
        self.inner.snapshot_json()
    }

    #[wasm_bindgen(js_name = replayJson)]
    pub fn replay_json(&self) -> String {
        self.inner.replay_json()
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }

    pub fn score(&self) -> u16 {
        self.inner.score()
    }
}

fn parse_policy(policy: &str) -> Result<AutoPlayPolicy, JsValue> {
    match policy {
        "off" => Ok(AutoPlayPolicy::Off),
        "safe" => Ok(AutoPlayPolicy::Safe),
        "max" => Ok(AutoPlayPolicy::Max),
        _ => Err(JsValue::from_str(
            "auto play policy must be one of: off, safe, max",
        )),
    }
}

fn to_js_error(error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
