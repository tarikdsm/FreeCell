use serde::{Deserialize, Serialize};

pub const ACTION_COUNT_OPTIONS: u16 = 13;
pub const SLOT_COUNT: u16 = 16;
pub const DESTINATION_COUNT_PER_SOURCE: u16 = SLOT_COUNT - 1;
pub const ACTION_SPACE_SIZE: usize =
    (SLOT_COUNT * DESTINATION_COUNT_PER_SOURCE * ACTION_COUNT_OPTIONS) as usize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SlotRef {
    Tableau { index: u8 },
    Freecell { index: u8 },
    Foundation { index: u8 },
}

impl SlotRef {
    pub fn flattened(self) -> u8 {
        match self {
            Self::Tableau { index } => index,
            Self::Freecell { index } => 8 + index,
            Self::Foundation { index } => 12 + index,
        }
    }

    pub fn from_flattened(index: u8) -> Option<Self> {
        match index {
            0..=7 => Some(Self::Tableau { index }),
            8..=11 => Some(Self::Freecell { index: index - 8 }),
            12..=15 => Some(Self::Foundation { index: index - 12 }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub action_index: Option<u16>,
    pub source: SlotRef,
    pub destination: SlotRef,
    pub count: u8,
}

impl Action {
    pub fn new(source: SlotRef, destination: SlotRef, count: u8) -> Self {
        let mut action = Self {
            action_index: None,
            source,
            destination,
            count,
        };
        action.action_index = encode_action(action);
        action
    }

    pub fn inverse(self) -> Self {
        Self::new(self.destination, self.source, self.count)
    }
}

pub fn encode_action(action: Action) -> Option<u16> {
    if !(1..=13).contains(&action.count) || action.source == action.destination {
        return None;
    }

    let source = action.source.flattened();
    let destination = action.destination.flattened();
    let destination_index = if destination < source {
        destination
    } else {
        destination.saturating_sub(1)
    };

    Some(
        ((source as u16) * DESTINATION_COUNT_PER_SOURCE + destination_index as u16)
            * ACTION_COUNT_OPTIONS
            + (action.count as u16 - 1),
    )
}

pub fn decode_action(index: u16) -> Option<Action> {
    if index as usize >= ACTION_SPACE_SIZE {
        return None;
    }

    let source = index / (DESTINATION_COUNT_PER_SOURCE * ACTION_COUNT_OPTIONS);
    let rest = index % (DESTINATION_COUNT_PER_SOURCE * ACTION_COUNT_OPTIONS);
    let destination_index = rest / ACTION_COUNT_OPTIONS;
    let count = (rest % ACTION_COUNT_OPTIONS) as u8 + 1;
    let destination = if destination_index < source {
        destination_index
    } else {
        destination_index + 1
    };

    Some(Action {
        action_index: Some(index),
        source: SlotRef::from_flattened(source as u8)?,
        destination: SlotRef::from_flattened(destination as u8)?,
        count,
    })
}
