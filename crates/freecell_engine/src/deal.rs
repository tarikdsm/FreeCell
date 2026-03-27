use crate::card::CardId;

pub fn microsoft_deal_deck(seed: u32) -> [CardId; 52] {
    let mut deck = core::array::from_fn(|index| CardId(index as u8));
    let mut rng = seed as u64;

    for index in 0..52usize {
        let cards_left = 52 - index as u64;
        rng = rng.wrapping_mul(214_013).wrapping_add(2_531_011);
        let rand = (rng >> 16) & 0x7fff;
        let picked = if seed < 0x8000_0000 {
            rand % cards_left
        } else {
            (rand | 0x8000) % cards_left
        };
        deck.swap(picked as usize, cards_left as usize - 1);
    }

    deck.reverse();
    deck
}
