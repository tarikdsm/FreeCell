use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Color {
    Black,
    Red,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
#[serde(rename_all = "lowercase")]
pub enum Suit {
    Spades = 0,
    Hearts = 1,
    Diamonds = 2,
    Clubs = 3,
}

impl Suit {
    pub const ALL: [Suit; 4] = [Suit::Spades, Suit::Hearts, Suit::Diamonds, Suit::Clubs];

    pub fn from_index(index: u8) -> Option<Self> {
        match index {
            0 => Some(Self::Spades),
            1 => Some(Self::Hearts),
            2 => Some(Self::Diamonds),
            3 => Some(Self::Clubs),
            _ => None,
        }
    }

    pub const fn index(self) -> u8 {
        self as u8
    }

    pub const fn color(self) -> Color {
        match self {
            Self::Spades | Self::Clubs => Color::Black,
            Self::Hearts | Self::Diamonds => Color::Red,
        }
    }

    pub const fn short_code(self) -> &'static str {
        match self {
            Self::Spades => "S",
            Self::Hearts => "H",
            Self::Diamonds => "D",
            Self::Clubs => "C",
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default,
)]
#[serde(transparent)]
pub struct CardId(pub u8);

impl CardId {
    pub fn new(raw: u8) -> Option<Self> {
        (raw < 52).then_some(Self(raw))
    }

    pub fn from_rank_and_suit(rank: u8, suit: Suit) -> Option<Self> {
        if !(1..=13).contains(&rank) {
            return None;
        }
        Some(Self(((rank - 1) << 2) + suit.index()))
    }

    pub const fn raw(self) -> u8 {
        self.0
    }

    pub fn suit(self) -> Suit {
        match self.0 & 3 {
            0 => Suit::Spades,
            1 => Suit::Hearts,
            2 => Suit::Diamonds,
            _ => Suit::Clubs,
        }
    }

    pub const fn rank(self) -> u8 {
        (self.0 >> 2) + 1
    }

    pub fn color(self) -> Color {
        self.suit().color()
    }

    pub const fn rank_label(self) -> &'static str {
        match self.rank() {
            1 => "A",
            2 => "2",
            3 => "3",
            4 => "4",
            5 => "5",
            6 => "6",
            7 => "7",
            8 => "8",
            9 => "9",
            10 => "T",
            11 => "J",
            12 => "Q",
            _ => "K",
        }
    }

    pub fn short_label(self) -> String {
        format!("{}{}", self.rank_label(), self.suit().short_code())
    }

    pub fn view(self) -> CardView {
        CardView {
            id: self.raw(),
            suit: self.suit(),
            rank: self.rank(),
            rank_label: self.rank_label().to_string(),
            short_label: self.short_label(),
            color: self.color(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardView {
    pub id: u8,
    pub suit: Suit,
    pub rank: u8,
    pub rank_label: String,
    pub short_label: String,
    pub color: Color,
}

impl From<CardId> for CardView {
    fn from(value: CardId) -> Self {
        value.view()
    }
}
