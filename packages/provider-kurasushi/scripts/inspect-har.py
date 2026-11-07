#!/usr/bin/env python3
"""Recover complete HAR entries and extract first-party application JS for inspection.

Raw HARs contain credentials. Output deliberately excludes query values, headers,
request bodies, and response bodies other than the public application bundles.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit


def recover_entries(source):
    decoder = json.JSONDecoder()
    position = source.index('[', source.index('"entries"')) + 1
    while position < len(source):
        while position < len(source) and source[position] in ' \r\n\t,':
            position += 1
        if position >= len(source) or source[position] == ']':
            return
        try:
            entry, position = decoder.raw_decode(source, position)
        except json.JSONDecodeError:
            # An incomplete final entry is not evidence about its response.
            return
        yield entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('har', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    count = 0
    for index, entry in enumerate(recover_entries(args.har.read_text())):
        count += 1
        request, response = entry['request'], entry['response']
        url = urlsplit(request['url'])
        content = response.get('content', {})
        if url.hostname == 'api-app.smart-order.epark.jp':
            print(request['method'], url.path, response['status'])
        if (url.hostname == 'kurasushi-so.epark.jp'
                and url.path.startswith('/js/') and url.path.endswith('.js')
                and 'chunk-vendors' not in url.path and content.get('text')):
            if content.get('encoding') == 'base64':
                raise ValueError('Base64 JS is not supported; decode it before inspection')
            target = args.output / f'{index}-{Path(url.path).name}'
            target.write_text(content['text'])
            print('Extracted', target.name)
    print('Recovered complete entries:', count)


if __name__ == '__main__':
    main()
