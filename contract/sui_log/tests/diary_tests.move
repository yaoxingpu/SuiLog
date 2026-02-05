#[test_only]
module sui_log::diary_tests {
    use sui::test_scenario as ts;
    use sui::clock;
    use std::string;
    use sui_log::diary;

    const OWNER: address = @0xA;

    #[test]
    fun test_share_and_burn_after_expiry() {
        let mut ts = ts::begin(OWNER);
        let mut clock = clock::create_for_testing(ts.ctx());

        diary::create_entry(
            string::utf8(b"Title"),
            string::utf8(b"blob_id"),
            vector[1, 2, 3],
            vector[9, 9, 9],
            vector[7, 7, 7],
            3,
            &clock,
            ts.ctx()
        );

        ts.next_tx(OWNER);
        let entry = ts.take_from_sender<diary::DiaryEntry>();
        diary::share_entry(
            &entry,
            vector[4, 4, 4],
            vector[5, 5, 5],
            vector[6, 6, 6],
            1000,
            &clock,
            ts.ctx()
        );
        ts.return_to_sender(entry);

        ts.next_tx(OWNER);
        let access: diary::SharedAccess = ts.take_shared();
        clock.increment_for_testing(2000);
        diary::burn_expired_access(access, &clock);

        clock.destroy_for_testing();
        ts.end();
    }

    #[test]
    #[expected_failure(abort_code = diary::ENotExpired)]
    fun test_burn_before_expiry() {
        let mut ts = ts::begin(OWNER);
        let mut clock = clock::create_for_testing(ts.ctx());

        diary::create_entry(
            string::utf8(b"Title"),
            string::utf8(b"blob_id"),
            vector[1, 2, 3],
            vector[9, 9, 9],
            vector[7, 7, 7],
            2,
            &clock,
            ts.ctx()
        );

        ts.next_tx(OWNER);
        let entry = ts.take_from_sender<diary::DiaryEntry>();
        diary::share_entry(
            &entry,
            vector[4, 4, 4],
            vector[5, 5, 5],
            vector[6, 6, 6],
            10_000,
            &clock,
            ts.ctx()
        );
        ts.return_to_sender(entry);

        ts.next_tx(OWNER);
        let access: diary::SharedAccess = ts.take_shared();
        diary::burn_expired_access(access, &clock);
        abort 0x1
    }

    #[test]
    fun test_extend_and_revoke() {
        let mut ts = ts::begin(OWNER);
        let mut clock = clock::create_for_testing(ts.ctx());

        diary::create_entry(
            string::utf8(b"Title"),
            string::utf8(b"blob_id"),
            vector[1, 2, 3],
            vector[9, 9, 9],
            vector[7, 7, 7],
            3,
            &clock,
            ts.ctx()
        );

        ts.next_tx(OWNER);
        let entry = ts.take_from_sender<diary::DiaryEntry>();
        diary::share_entry(
            &entry,
            vector[4, 4, 4],
            vector[5, 5, 5],
            vector[6, 6, 6],
            1000,
            &clock,
            ts.ctx()
        );
        ts.return_to_sender(entry);

        ts.next_tx(OWNER);
        let mut access: diary::SharedAccess = ts.take_shared();
        let before = diary::share_expiry_for_testing(&access);
        diary::extend_access(&mut access, 5000, &clock, ts.ctx());
        let after = diary::share_expiry_for_testing(&access);
        assert!(after > before, 1);
        ts::return_shared(access);

        ts.next_tx(OWNER);
        let access: diary::SharedAccess = ts.take_shared();
        diary::revoke_access(access, ts.ctx());

        clock.destroy_for_testing();
        ts.end();
    }

    #[test]
    #[expected_failure(abort_code = diary::ENotOwner)]
    fun test_revoke_wrong_owner() {
        let mut ts = ts::begin(OWNER);
        let mut clock = clock::create_for_testing(ts.ctx());

        diary::create_entry(
            string::utf8(b"Title"),
            string::utf8(b"blob_id"),
            vector[1, 2, 3],
            vector[9, 9, 9],
            vector[7, 7, 7],
            3,
            &clock,
            ts.ctx()
        );

        ts.next_tx(OWNER);
        let entry = ts.take_from_sender<diary::DiaryEntry>();
        diary::share_entry(
            &entry,
            vector[4, 4, 4],
            vector[5, 5, 5],
            vector[6, 6, 6],
            1000,
            &clock,
            ts.ctx()
        );
        ts.return_to_sender(entry);

        ts.next_tx(@0xB);
        let access: diary::SharedAccess = ts.take_shared();
        diary::revoke_access(access, ts.ctx());
        abort 0x1
    }
}
