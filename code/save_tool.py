import argparse
import base64
import binascii
import bz2
import gzip
import json
import lzma
import math
import struct
import zlib
from pathlib import Path


WRAPPER_PREFIX = "[A|"
WRAPPER_SUFFIX = "]"
JSON_FORMAT = "idle-tower-builder-save-json"
JSON_CODEC = "game-array-v1"
ITEMS_JSON_CODEC = "outer-v1/equal-items-v1"
CUSTOM_BASE64_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+="


def read_save(path):
    text = Path(path).read_text(encoding="utf-8").strip()
    if not text.startswith(WRAPPER_PREFIX) or not text.endswith(WRAPPER_SUFFIX):
        raise ValueError(f"{path} is not wrapped as {WRAPPER_PREFIX}...{WRAPPER_SUFFIX}")
    return text


def unwrap_save(text):
    return text[len(WRAPPER_PREFIX) : -len(WRAPPER_SUFFIX)]


def decode_custom_base64(text):
    output = bytearray()
    remainder = len(text) % 4
    limit = len(text) - remainder

    for offset in range(0, limit, 4):
        first, second, third, fourth = (
            CUSTOM_BASE64_ALPHABET.index(text[offset]),
            CUSTOM_BASE64_ALPHABET.index(text[offset + 1]),
            CUSTOM_BASE64_ALPHABET.index(text[offset + 2]),
            CUSTOM_BASE64_ALPHABET.index(text[offset + 3]),
        )
        output.append(((first << 2 | second >> 4) - 128) & 0xFF)
        output.append((((second & 15) << 4 | third >> 2) - 128) & 0xFF)
        output.append((((third & 3) << 6 | fourth) - 128) & 0xFF)

    if remainder == 3:
        first, second, third = (
            CUSTOM_BASE64_ALPHABET.index(text[-3]),
            CUSTOM_BASE64_ALPHABET.index(text[-2]),
            CUSTOM_BASE64_ALPHABET.index(text[-1]),
        )
        output.append(((first << 2 | second >> 4) - 128) & 0xFF)
        output.append((((second & 15) << 4 | third >> 2) - 128) & 0xFF)
    elif remainder == 2:
        first, second = (
            CUSTOM_BASE64_ALPHABET.index(text[-2]),
            CUSTOM_BASE64_ALPHABET.index(text[-1]),
        )
        output.append(((first << 2 | second >> 4) - 128) & 0xFF)
    elif remainder == 1:
        raise ValueError("Custom base64 payload cannot have length modulo 4 equal to 1")

    return bytes(output)


def encode_custom_base64(data):
    result = []
    index = 0
    while index < len(data):
        available = len(data) - index
        if available >= 3:
            first, second, third = data[index], data[index + 1], data[index + 2]
            index += 3
            first = ((first + 128) & 0xFF)
            second = ((second + 128) & 0xFF)
            third = ((third + 128) & 0xFF)
            result.append(CUSTOM_BASE64_ALPHABET[first >> 2])
            result.append(CUSTOM_BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)])
            result.append(CUSTOM_BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)])
            result.append(CUSTOM_BASE64_ALPHABET[third & 63])
        elif available == 2:
            first, second = data[index], data[index + 1]
            index += 2
            first = ((first + 128) & 0xFF)
            second = ((second + 128) & 0xFF)
            result.append(CUSTOM_BASE64_ALPHABET[first >> 2])
            result.append(CUSTOM_BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)])
            result.append(CUSTOM_BASE64_ALPHABET[(second & 15) << 2])
        else:
            first = ((data[index] + 128) & 0xFF)
            index += 1
            result.append(CUSTOM_BASE64_ALPHABET[first >> 2])
            result.append(CUSTOM_BASE64_ALPHABET[(first & 3) << 4])
    return "".join(result)


def decode_payload(text):
    return decode_custom_base64(unwrap_save(text))


def encode_payload(payload):
    return WRAPPER_PREFIX + encode_custom_base64(payload) + WRAPPER_SUFFIX


def payload_to_number_array(payload):
    raw = zlib.decompress(payload)
    if len(raw) < 8 or len(raw) % 8 != 0:
        raise ValueError("Inflated payload is not a double array")
    stored_length = struct.unpack(">d", raw[:8])[0]
    if not stored_length.is_integer():
        raise ValueError(f"Stored array length is not an integer: {stored_length}")
    values = [struct.unpack(">d", raw[offset : offset + 8])[0] for offset in range(8, len(raw), 8)]
    if int(stored_length) != len(values):
        raise ValueError(f"Stored array length mismatch: expected {stored_length}, got {len(values)}")
    return values


def number_array_to_payload(values):
    raw = bytearray()
    raw.extend(struct.pack(">d", float(len(values))))
    for value in values:
        raw.extend(struct.pack(">d", float(value)))
    return zlib.compress(bytes(raw))


def decode_save_to_numbers(text):
    return payload_to_number_array(decode_payload(text))


def encode_numbers_to_save(values):
    return encode_payload(number_array_to_payload(values))


def payload_to_json_document(payload, source=None):
    values = payload_to_number_array(payload)
    return {
        "format": JSON_FORMAT,
        "codec": JSON_CODEC,
        "source": source,
        "wrapper": "A",
        "payload": {
            "encoding": "custom-base64-zlib-double-array",
            "bytes": len(payload),
            "header_hex": binascii.hexlify(payload[:16]).decode("ascii"),
        },
        "game_data": {
            "type": "number_array",
            "count": len(values),
            "values": values,
            "annotations": {},
        },
        "notes": [
            "Values are saved by the game as 64-bit big-endian floats, then zlib-compressed.",
            "Use game_data.annotations to name discovered indices.",
        ],
    }


def payload_from_json_document(document):
    if document.get("format") != JSON_FORMAT:
        raise ValueError(f"JSON format must be {JSON_FORMAT!r}")
    if document.get("codec") != JSON_CODEC:
        raise ValueError(f"JSON codec must be {JSON_CODEC!r}")
    game_data = document.get("game_data")
    if not isinstance(game_data, dict):
        raise ValueError("JSON document is missing game_data object")
    values = game_data.get("values")
    if not isinstance(values, list):
        raise ValueError("JSON game_data.values must be a list")
    return number_array_to_payload(values)


def decode_base64_item(raw):
    if raw == "":
        return None
    padded = raw + "=" * (-len(raw) % 4)
    try:
        return base64.b64decode(padded)
    except binascii.Error:
        return None


def item_interpretations(raw):
    decoded = decode_base64_item(raw)
    result = {
        "chars": len(raw),
        "raw": raw,
        "value": None,
        "meaning": None,
    }
    if decoded is None:
        result["base64"] = None
        return result

    result["base64"] = {
        "bytes": len(decoded),
        "hex": binascii.hexlify(decoded[:32]).decode("ascii"),
        "ascii_preview": text_preview(decoded),
    }

    if len(decoded) <= 8:
        result["base64"]["uint_be"] = int.from_bytes(decoded, "big", signed=False)
        result["base64"]["uint_le"] = int.from_bytes(decoded, "little", signed=False)
        result["base64"]["int_be"] = int.from_bytes(decoded, "big", signed=True)
        result["base64"]["int_le"] = int.from_bytes(decoded, "little", signed=True)

    return result


def save_to_items_document(text, source=None):
    body = unwrap_save(text)
    items = []
    for index, raw in enumerate(body.split("="), start=1):
        item = item_interpretations(raw)
        item["id"] = f"item_{index:03d}"
        items.append(item)
    return {
        "format": JSON_FORMAT,
        "codec": ITEMS_JSON_CODEC,
        "source": source,
        "wrapper": "A",
        "separator": "=",
        "items": items,
        "game_data": {},
        "notes": [
            "Items are split on '=' and rejoined with '=' for exact round-trip encoding.",
            "Use value/meaning to annotate discoveries; raw is what currently controls encoding.",
        ],
    }


def items_document_to_save(document):
    if document.get("format") != JSON_FORMAT:
        raise ValueError(f"JSON format must be {JSON_FORMAT!r}")
    if document.get("codec") != ITEMS_JSON_CODEC:
        raise ValueError(f"JSON codec must be {ITEMS_JSON_CODEC!r}")
    separator = document.get("separator", "=")
    items = document.get("items")
    if not isinstance(items, list):
        raise ValueError("JSON document is missing items list")
    raw_items = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Item {index} must be an object")
        raw = item.get("raw")
        if not isinstance(raw, str):
            raise ValueError(f"Item {index} is missing raw string")
        raw_items.append(raw)
    return WRAPPER_PREFIX + separator.join(raw_items) + WRAPPER_SUFFIX


def entropy(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for byte in data:
        counts[byte] += 1
    total = len(data)
    return -sum((count / total) * math.log2(count / total) for count in counts if count)


def printable_runs(data, min_len=4):
    runs = []
    current = bytearray()
    for byte in data:
        if 32 <= byte < 127:
            current.append(byte)
        else:
            if len(current) >= min_len:
                runs.append(current.decode("ascii", errors="replace"))
            current.clear()
    if len(current) >= min_len:
        runs.append(current.decode("ascii", errors="replace"))
    return runs


def try_decompressions(data):
    attempts = []
    codecs = [
        ("zlib", zlib.decompress),
        ("gzip", gzip.decompress),
        ("bz2", bz2.decompress),
        ("lzma", lzma.decompress),
    ]
    for offset in range(min(64, len(data))):
        chunk = data[offset:]
        for name, func in codecs:
            try:
                output = func(chunk)
            except Exception:
                continue
            attempts.append(
                {
                    "codec": name,
                    "offset": offset,
                    "bytes": len(output),
                    "entropy": entropy(output),
                    "preview": text_preview(output),
                }
            )
    return attempts


def text_preview(data, limit=120):
    return "".join(chr(byte) if 32 <= byte < 127 else "." for byte in data[:limit])


def numeric_hits(data, values):
    hits = []
    encodings = []
    for value in values:
        if isinstance(value, int):
            for endian in ("<", ">"):
                encodings.extend(
                    [
                        (value, f"{endian}u16", struct.pack(endian + "H", value & 0xFFFF)),
                        (value, f"{endian}u32", struct.pack(endian + "I", value & 0xFFFFFFFF)),
                        (value, f"{endian}i32", struct.pack(endian + "i", value)),
                        (value, f"{endian}f64", struct.pack(endian + "d", float(value))),
                    ]
                )
        encodings.append((value, "ascii", str(value).encode("ascii")))

    for value, encoding, needle in encodings:
        start = 0
        while True:
            offset = data.find(needle, start)
            if offset == -1:
                break
            hits.append(
                {
                    "value": value,
                    "encoding": encoding,
                    "offset": offset,
                    "hex": binascii.hexlify(needle).decode("ascii"),
                }
            )
            start = offset + 1
    return hits


def describe(path):
    text = read_save(path)
    body = unwrap_save(text)
    payload = decode_payload(text)
    chars = "".join(sorted(set(text)))
    equal_count = body.count("=")
    return {
        "path": str(path),
        "wrapped_chars": len(text),
        "body_chars": len(body),
        "payload_bytes": len(payload),
        "payload_header_hex": binascii.hexlify(payload[:16]).decode("ascii"),
        "payload_entropy": entropy(payload),
        "equal_count": equal_count,
        "charset": chars,
        "printable_runs": printable_runs(payload)[:20],
    }


def common_prefix(left, right):
    limit = min(len(left), len(right))
    for index in range(limit):
        if left[index] != right[index]:
            return index
    return limit


def common_suffix(left, right, prefix_len):
    limit = min(len(left), len(right)) - prefix_len
    for offset in range(limit):
        if left[len(left) - 1 - offset] != right[len(right) - 1 - offset]:
            return offset
    return limit


def compare(left_path, right_path, max_diffs):
    left = decode_payload(read_save(left_path))
    right = decode_payload(read_save(right_path))
    limit = min(len(left), len(right))
    same = sum(1 for index in range(limit) if left[index] == right[index])
    prefix_len = common_prefix(left, right)
    suffix_len = common_suffix(left, right, prefix_len)
    diffs = []
    for index in range(limit):
        if left[index] != right[index]:
            diffs.append((index, left[index], right[index]))
            if len(diffs) >= max_diffs:
                break
    return {
        "left_bytes": len(left),
        "right_bytes": len(right),
        "same_bytes_in_overlap": same,
        "overlap_bytes": limit,
        "same_percent": (same / limit * 100) if limit else 100.0,
        "common_prefix": prefix_len,
        "common_suffix": suffix_len,
        "first_diffs": diffs,
    }


def diff_ranges(left, right):
    limit = min(len(left), len(right))
    ranges = []
    start = None
    for index in range(limit):
        different = left[index] != right[index]
        if different and start is None:
            start = index
        elif not different and start is not None:
            ranges.append((start, index - 1))
            start = None
    if start is not None:
        ranges.append((start, limit - 1))
    if len(left) != len(right):
        ranges.append((limit, max(len(left), len(right)) - 1))
    return ranges


def cmd_info(args):
    for path in args.save:
        info = describe(path)
        print(info["path"])
        print(f"  wrapped chars: {info['wrapped_chars']}")
        print(f"  body chars:    {info['body_chars']}")
        print(f"  payload bytes: {info['payload_bytes']}")
        print(f"  header hex:    {info['payload_header_hex']}")
        print(f"  entropy:       {info['payload_entropy']:.3f} bits/byte")
        print(f"  '=' alphabet:  {info['equal_count']} occurrences")
        print(f"  charset:       {info['charset']}")
        if info["printable_runs"]:
            print("  printable runs:")
            for run in info["printable_runs"]:
                print(f"    {run}")
        print()


def cmd_decode(args):
    payload = decode_payload(read_save(args.save))
    Path(args.output).write_bytes(payload)
    print(f"wrote {len(payload)} bytes to {args.output}")


def cmd_encode(args):
    payload = Path(args.payload).read_bytes()
    text = encode_payload(payload)
    Path(args.output).write_text(text, encoding="utf-8")
    print(f"wrote {len(text)} chars to {args.output}")


def cmd_save_to_json(args):
    payload = decode_payload(read_save(args.save))
    document = payload_to_json_document(payload, source=str(args.save))
    Path(args.output).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"wrote JSON bridge to {args.output}")


def cmd_json_to_save(args):
    document = json.loads(Path(args.json).read_text(encoding="utf-8"))
    payload = payload_from_json_document(document)
    text = encode_payload(payload)
    Path(args.output).write_text(text, encoding="utf-8")
    print(f"wrote save string to {args.output}")


def cmd_save_to_items(args):
    text = read_save(args.save)
    document = save_to_items_document(text, source=str(args.save))
    Path(args.output).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(document['items'])} items to {args.output}")


def cmd_items_to_save(args):
    document = json.loads(Path(args.json).read_text(encoding="utf-8"))
    text = items_document_to_save(document)
    Path(args.output).write_text(text, encoding="utf-8")
    print(f"wrote save string to {args.output}")


def cmd_compare(args):
    left_payload = decode_payload(read_save(args.left))
    right_payload = decode_payload(read_save(args.right))
    result = compare(args.left, args.right, args.max_diffs)
    print(f"left bytes:  {result['left_bytes']}")
    print(f"right bytes: {result['right_bytes']}")
    print(
        "same bytes:  "
        f"{result['same_bytes_in_overlap']}/{result['overlap_bytes']} "
        f"({result['same_percent']:.2f}%)"
    )
    print(f"common prefix: {result['common_prefix']} bytes")
    print(f"common suffix: {result['common_suffix']} bytes")
    ranges = diff_ranges(left_payload, right_payload)
    changed_bytes = sum((end - start + 1) for start, end in ranges)
    print(f"diff ranges: {len(ranges)} ranges covering {changed_bytes} bytes")
    for start, end in ranges[: args.max_ranges]:
        print(f"  range {start:6d}-{end:6d} ({end - start + 1} bytes)")
    print("first diffs:")
    for offset, left_byte, right_byte in result["first_diffs"]:
        print(f"  {offset:6d}: {left_byte:02x} -> {right_byte:02x}")


def cmd_probe(args):
    payload = decode_payload(read_save(args.save))
    print(f"payload bytes: {len(payload)}")
    print(f"header hex:    {binascii.hexlify(payload[:32]).decode('ascii')}")
    print(f"entropy:       {entropy(payload):.3f} bits/byte")
    print(f"text preview:  {text_preview(payload)}")

    runs = printable_runs(payload, min_len=args.min_string)
    print(f"printable runs >= {args.min_string}: {len(runs)}")
    for run in runs[: args.max_strings]:
        print(f"  {run}")

    decompressions = try_decompressions(payload)
    print(f"decompression hits: {len(decompressions)}")
    for hit in decompressions[:20]:
        print(
            f"  {hit['codec']} at {hit['offset']}: "
            f"{hit['bytes']} bytes, entropy {hit['entropy']:.3f}, {hit['preview']}"
        )

    if args.known:
        values = []
        for raw in args.known:
            try:
                values.append(int(raw, 0))
            except ValueError:
                values.append(raw)
        hits = numeric_hits(payload, values)
        print(f"known-value raw hits: {len(hits)}")
        for hit in hits[: args.max_hits]:
            print(
                f"  value={hit['value']!r} encoding={hit['encoding']} "
                f"offset={hit['offset']} hex={hit['hex']}"
            )


def main():
    parser = argparse.ArgumentParser(description="Idle Tower Builder save workbench")
    subparsers = parser.add_subparsers(required=True)

    info_parser = subparsers.add_parser("info", help="show outer format details")
    info_parser.add_argument("save", nargs="+")
    info_parser.set_defaults(func=cmd_info)

    decode_parser = subparsers.add_parser("decode", help="unwrap save to binary payload")
    decode_parser.add_argument("save")
    decode_parser.add_argument("output")
    decode_parser.set_defaults(func=cmd_decode)

    encode_parser = subparsers.add_parser("encode", help="wrap binary payload as save text")
    encode_parser.add_argument("payload")
    encode_parser.add_argument("output")
    encode_parser.set_defaults(func=cmd_encode)

    save_to_json_parser = subparsers.add_parser(
        "save-to-json",
        help="convert a save string to a round-trippable JSON bridge",
    )
    save_to_json_parser.add_argument("save")
    save_to_json_parser.add_argument("output")
    save_to_json_parser.set_defaults(func=cmd_save_to_json)

    json_to_save_parser = subparsers.add_parser(
        "json-to-save",
        help="convert a JSON bridge back to a save string",
    )
    json_to_save_parser.add_argument("json")
    json_to_save_parser.add_argument("output")
    json_to_save_parser.set_defaults(func=cmd_json_to_save)

    save_to_items_parser = subparsers.add_parser(
        "save-to-items",
        help="split a save into anonymous item_001/item_002 JSON fields",
    )
    save_to_items_parser.add_argument("save")
    save_to_items_parser.add_argument("output")
    save_to_items_parser.set_defaults(func=cmd_save_to_items)

    items_to_save_parser = subparsers.add_parser(
        "items-to-save",
        help="rebuild a save string from anonymous item JSON",
    )
    items_to_save_parser.add_argument("json")
    items_to_save_parser.add_argument("output")
    items_to_save_parser.set_defaults(func=cmd_items_to_save)

    compare_parser = subparsers.add_parser("compare", help="compare two binary payloads")
    compare_parser.add_argument("left")
    compare_parser.add_argument("right")
    compare_parser.add_argument("--max-diffs", type=int, default=40)
    compare_parser.add_argument("--max-ranges", type=int, default=20)
    compare_parser.set_defaults(func=cmd_compare)

    probe_parser = subparsers.add_parser(
        "probe",
        help="probe the decoded payload for strings, compression, and known raw values",
    )
    probe_parser.add_argument("save")
    probe_parser.add_argument("--known", nargs="*", default=[])
    probe_parser.add_argument("--min-string", type=int, default=4)
    probe_parser.add_argument("--max-strings", type=int, default=30)
    probe_parser.add_argument("--max-hits", type=int, default=80)
    probe_parser.set_defaults(func=cmd_probe)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
