module sui_log::diary;

use std::string::String;
use sui::clock::Clock;
use sui::event;
use sui::object;
use sui::transfer;

public struct DiaryEntry has key, store {
    id: UID,
    title: String,
    content_blob_id: String, // Walrus Blob ID
    iv: vector<u8>, // AES-GCM IV (content)
    encrypted_dek: vector<u8>, // DEK encrypted by vault key
    dek_iv: vector<u8>, // AES-GCM IV (DEK)
    mood: u8,
    timestamp: u64,
    unlock_at: u64, // 0 = immediate
}

public struct SharedAccess has key, store {
    id: UID,
    entry_id: ID,
    encrypted_key: vector<u8>, // DEK encrypted by share password
    key_iv: vector<u8>, // AES-GCM IV (shared DEK)
    key_salt: vector<u8>, // PBKDF2 salt
    expiry: u64,
    owner: address,
}

// Events
public struct EntryCreated has copy, drop {
    id: ID,
    owner: address,
}

public struct AccessShared has copy, drop {
    id: ID,
    entry_id: ID,
    expiry: u64,
    owner: address,
}

public struct AccessExtended has copy, drop {
    id: ID,
    entry_id: ID,
    new_expiry: u64,
    owner: address,
}

public struct AccessRevoked has copy, drop {
    id: ID,
    entry_id: ID,
    owner: address,
}

// On-chain情绪聚合
public struct MoodBoard has key, store {
    id: UID,
    counts: vector<u64>, // length 5, moods 1-5
    last_updated: u64,
}

// Errors
const ENotExpired: u64 = 0;
const ENotOwner: u64 = 1;

public fun create_entry(
    title: String,
    content_blob_id: String,
    iv: vector<u8>,
    encrypted_dek: vector<u8>,
    dek_iv: vector<u8>,
    mood: u8,
    clock: &Clock,
    ctx: &mut TxContext
) {
    create_entry_internal(
        title,
        content_blob_id,
        iv,
        encrypted_dek,
        dek_iv,
        mood,
        /*unlock_after_ms*/ 0,
        clock,
        ctx
    );
}

/// V2: 支持解锁时间（毫秒延迟）且可与 MoodBoard 配合
public fun create_entry_v2(
    title: String,
    content_blob_id: String,
    iv: vector<u8>,
    encrypted_dek: vector<u8>,
    dek_iv: vector<u8>,
    mood: u8,
    unlock_after_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    create_entry_internal(
        title,
        content_blob_id,
        iv,
        encrypted_dek,
        dek_iv,
        mood,
        unlock_after_ms,
        clock,
        ctx
    );
}

public fun create_entry_with_board(
    title: String,
    content_blob_id: String,
    iv: vector<u8>,
    encrypted_dek: vector<u8>,
    dek_iv: vector<u8>,
    mood: u8,
    unlock_after_ms: u64,
    board: &mut MoodBoard,
    clock: &Clock,
    ctx: &mut TxContext
) {
    create_entry_internal(
        title,
        content_blob_id,
        iv,
        encrypted_dek,
        dek_iv,
        mood,
        unlock_after_ms,
        clock,
        ctx
    );
    bump_mood(board, mood, clock);
}

fun create_entry_internal(
    title: String,
    content_blob_id: String,
    iv: vector<u8>,
    encrypted_dek: vector<u8>,
    dek_iv: vector<u8>,
    mood: u8,
    unlock_after_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let id = object::new(ctx);
    let entry = DiaryEntry {
        id,
        title,
        content_blob_id,
        iv,
        encrypted_dek,
        dek_iv,
        mood,
        timestamp: clock.timestamp_ms(),
        unlock_at: clock.timestamp_ms() + unlock_after_ms,
    };
    event::emit(EntryCreated { id: object::id(&entry), owner: ctx.sender() });
    transfer::transfer(entry, ctx.sender());
}

public fun share_entry(
    entry: &DiaryEntry,
    encrypted_key: vector<u8>,
    key_iv: vector<u8>,
    key_salt: vector<u8>,
    duration_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let entry_id = object::id(entry);
    let expiry = clock.timestamp_ms() + duration_ms;
    let access = SharedAccess {
        id: object::new(ctx),
        entry_id,
        encrypted_key,
        key_iv,
        key_salt,
        expiry,
        owner: ctx.sender(),
    };
    event::emit(AccessShared { id: object::id(&access), entry_id, expiry, owner: ctx.sender() });
    transfer::public_share_object(access);
}

public fun extend_access(
    access: &mut SharedAccess,
    duration_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext
) {
    assert!(ctx.sender() == access.owner, ENotOwner);
    let now = clock.timestamp_ms();
    let base = if (access.expiry > now) { access.expiry } else { now };
    access.expiry = base + duration_ms;
    event::emit(AccessExtended {
        id: object::id(access),
        entry_id: access.entry_id,
        new_expiry: access.expiry,
        owner: access.owner
    });
}

public fun revoke_access(
    access: SharedAccess,
    ctx: &mut TxContext
) {
    assert!(ctx.sender() == access.owner, ENotOwner);
    let access_id = object::id(&access);
    let entry_id = access.entry_id;
    let owner = access.owner;
    event::emit(AccessRevoked { id: access_id, entry_id, owner });
    let SharedAccess { id, entry_id: _, encrypted_key: _, key_iv: _, key_salt: _, expiry: _, owner: _ } = access;
    object::delete(id);
}

// Clean up expired access (optional, anyone can call to clean up state)
public fun burn_expired_access(
    access: SharedAccess,
    clock: &Clock
) {
    assert!(clock.timestamp_ms() > access.expiry, ENotExpired);
    let SharedAccess { id, entry_id: _, encrypted_key: _, key_iv: _, key_salt: _, expiry: _, owner: _ } = access;
    object::delete(id);
}

#[test_only]
public fun share_expiry_for_testing(access: &SharedAccess): u64 {
    access.expiry
}

/// 初始化情绪看板
public fun init_mood_board(clock: &Clock, ctx: &mut TxContext): MoodBoard {
    let counts = vector::empty<u64>();
    // moods 1..5
    vector::push_back(&mut counts, 0);
    vector::push_back(&mut counts, 0);
    vector::push_back(&mut counts, 0);
    vector::push_back(&mut counts, 0);
    vector::push_back(&mut counts, 0);
    MoodBoard {
        id: object::new(ctx),
        counts,
        last_updated: clock.timestamp_ms(),
    }
}

/// 更新情绪计数
public fun bump_mood(board: &mut MoodBoard, mood: u8, clock: &Clock) {
    if (mood < 1 || mood > 5) {
        return;
    }
    let idx = (mood - 1) as u64;
    let current = *vector::borrow(&board.counts, idx);
    *vector::borrow_mut(&mut board.counts, idx) = current + 1;
    board.last_updated = clock.timestamp_ms();
}
