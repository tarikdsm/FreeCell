use serde::{Deserialize, Serialize};

use crate::{
    action::Action,
    card::{CardView, Suit},
    state::DealMode,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutoPlayPolicy {
    Off,
    Safe,
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineStatus {
    Playing,
    Won,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundationView {
    pub index: u8,
    pub suit: Suit,
    pub count: u8,
    pub next_rank: u8,
    pub top_card: Option<CardView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeCellView {
    pub index: u8,
    pub card: Option<CardView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnView {
    pub index: u8,
    pub cards: Vec<CardView>,
    pub movable_run_length: u8,
    pub sorted_run_length: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshot {
    pub version: u8,
    pub seed: u32,
    pub deal_mode: DealMode,
    pub status: EngineStatus,
    pub auto_play_policy: AutoPlayPolicy,
    pub move_count: u32,
    pub turn_index: u32,
    pub score: u16,
    pub legal_move_capacity: u8,
    pub state_hash: String,
    pub foundations: Vec<FoundationView>,
    pub freecells: Vec<FreeCellView>,
    pub tableau: Vec<ColumnView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRecord {
    pub turn_index: u32,
    pub requested: Option<Action>,
    pub executed: Vec<Action>,
    pub auto_played: bool,
    pub foundation_delta: i16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayExport {
    pub version: u8,
    pub seed: u32,
    pub deal_mode: DealMode,
    pub auto_play_policy: AutoPlayPolicy,
    pub turns: Vec<TurnRecord>,
    pub final_state_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    pub applied: bool,
    pub reward: f32,
    pub terminal: bool,
    pub turn: Option<TurnRecord>,
    pub state: GameSnapshot,
    pub illegal_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HintKind {
    AutoPlay,
    Forced,
    Search,
    Solved,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HintOptions {
    pub max_depth: u8,
    pub max_nodes: u32,
}

impl Default for HintOptions {
    fn default() -> Self {
        Self {
            max_depth: 12,
            max_nodes: 2_500,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HintAnalysis {
    pub kind: HintKind,
    pub suggested: Option<Action>,
    pub principal_variation: Vec<Action>,
    pub explored_nodes: u32,
    pub solved: bool,
    pub score: i32,
    pub message: String,
}
