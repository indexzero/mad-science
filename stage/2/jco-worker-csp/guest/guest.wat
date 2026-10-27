;; Core module for the `washe:poc/guest` world, written by hand so the
;; build needs no Rust toolchain. It follows the canonical ABI for:
;;   import washe:poc/host.log: func(msg: string)
;;   export run: func(input: string) -> string
(module
  (import "washe:poc/host" "log" (func $log (param i32 i32)))

  (memory (export "memory") 1)
  (data (i32.const 16) "guest: run called")  ;; 17 bytes at offset 16

  ;; Bump allocator. The heap starts at 1024 and resets after each call.
  (global $heap (mut i32) (i32.const 1024))

  (func $realloc (export "cabi_realloc")
    (param $old i32) (param $old_size i32) (param $align i32) (param $size i32)
    (result i32)
    (local $p i32)
    (local.set $p
      (i32.and
        (i32.add (global.get $heap) (i32.sub (local.get $align) (i32.const 1)))
        (i32.sub (i32.const 0) (local.get $align))))
    (global.set $heap (i32.add (local.get $p) (local.get $size)))
    (block $fits
      (br_if $fits
        (i32.le_u (global.get $heap) (i32.mul (memory.size) (i32.const 65536))))
      (drop
        (memory.grow
          (i32.add
            (i32.shr_u
              (i32.sub (global.get $heap) (i32.mul (memory.size) (i32.const 65536)))
              (i32.const 16))
            (i32.const 1)))))
    (if (local.get $old)
      (then (memory.copy (local.get $p) (local.get $old) (local.get $old_size))))
    (local.get $p))

  (func (export "run") (param $ptr i32) (param $len i32) (result i32)
    (local $i i32) (local $c i32) (local $count i32) (local $in_word i32)
    (local $out i32) (local $end i32) (local $n i32)
    (call $log (i32.const 16) (i32.const 17))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $c (i32.load8_u (i32.add (local.get $ptr) (local.get $i))))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9)))
              (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
          (then (local.set $in_word (i32.const 0)))
          (else
            (if (i32.eqz (local.get $in_word))
              (then
                (local.set $count (i32.add (local.get $count) (i32.const 1)))
                (local.set $in_word (i32.const 1))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    ;; 8-byte return area (ptr, len), then up to 16 decimal digits.
    (local.set $out (call $realloc (i32.const 0) (i32.const 0) (i32.const 4) (i32.const 24)))
    (local.set $end (i32.add (local.get $out) (i32.const 24)))
    (local.set $n (local.get $end))
    (loop $digit
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (i32.store8 (local.get $n)
        (i32.add (i32.const 48) (i32.rem_u (local.get $count) (i32.const 10))))
      (local.set $count (i32.div_u (local.get $count) (i32.const 10)))
      (br_if $digit (local.get $count)))
    (i32.store (local.get $out) (local.get $n))
    (i32.store offset=4 (local.get $out) (i32.sub (local.get $end) (local.get $n)))
    (local.get $out))

  (func (export "cabi_post_run") (param i32)
    (global.set $heap (i32.const 1024)))
)
