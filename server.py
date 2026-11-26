import http.client
import ipaddress
import json
import re
import socket
import ssl
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit


class PreviewBlocked(ValueError):
    pass


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = {}
        self.title = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        if tag == 'meta':
            attrs = dict(attrs)
            key = (attrs.get('property') or attrs.get('name') or '').lower()
            if key and attrs.get('content'):
                self.tags.setdefault(key, attrs['content'].strip())

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)


def fetch_preview(url, *, oembed=False):
    accept = 'application/json' if oembed else 'text/html'
    content_types = ('application/json',) if oembed else ('text/html', 'application/xhtml+xml')
    check_redirected_pin = not oembed and urlsplit(url).netloc.lower() == 'pin.it'
    for _ in range(4):
        parts = urlsplit(url)
        if check_redirected_pin and (endpoint := pinterest_endpoint(parts)):
            check_redirected_pin = False
            result = try_oembed(endpoint)
            if result and result['image']:
                return result
        if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
            raise ValueError('Enter a public HTTP or HTTPS link.')
        port = 443 if parts.scheme == 'https' else 80
        if parts.port not in (None, port):
            raise ValueError('This link uses an unsupported port.')
        addresses = list(dict.fromkeys(row[4][0] for row in socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)))
        if not addresses or any(not ipaddress.ip_address(address).is_global or ipaddress.ip_address(address).is_multicast for address in addresses):
            raise ValueError('Enter a public website link.')

        # Connect to a validated address while preserving the original hostname for TLS.
        if parts.scheme == 'https':
            connection = http.client.HTTPSConnection(parts.hostname, port, timeout=3, context=ssl.create_default_context())
        else:
            connection = http.client.HTTPConnection(parts.hostname, port, timeout=3)

        def connect_address(destination, timeout, source_address):
            for address in addresses:
                try:
                    return socket.create_connection((address, destination[1]), timeout, source_address)
                except OSError as error:
                    last_error = error
            raise last_error

        connection._create_connection = connect_address
        try:
            path = parts.path or '/'
            if parts.query:
                path += '?' + parts.query
            connection.request('GET', path, headers={'User-Agent': 'StudyPlanner/1.0', 'Accept': accept})
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308) and response.getheader('Location'):
                url = urljoin(url, response.getheader('Location'))
                continue
            if response.status in (401, 403):
                raise PreviewBlocked('The source site denied preview access.')
            if response.status != 200 or response.headers.get_content_type() not in content_types:
                raise ValueError('This page does not provide a preview.')
            markup = response.read(512 * 1024)
            charset = response.headers.get_content_charset() or 'utf-8'
            if oembed:
                payload = json.loads(markup.decode(charset))
                if not isinstance(payload, dict):
                    raise ValueError('Invalid preview metadata.')
                return {
                    'title': preview_text(payload.get('title'), 200),
                    'description': preview_text(payload.get('description'), 350),
                    'image': image_url(url, payload.get('thumbnail_url')),
                }
            metadata = Metadata()
            metadata.feed(markup.decode(charset, errors='replace'))
            tags = metadata.tags
            return {
                'title': (tags.get('og:title') or tags.get('twitter:title') or ' '.join(''.join(metadata.title).split()))[:200],
                'description': (tags.get('og:description') or tags.get('description') or tags.get('twitter:description') or '')[:350],
                'image': image_url(url, tags.get('og:image') or tags.get('twitter:image')),
            }
        finally:
            connection.close()
    raise ValueError('This link redirects too many times.')


def preview_text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ''


def image_url(base, value):
    if not isinstance(value, str) or not value.strip():
        return ''
    try:
        image = urljoin(base, value.strip())
        parts = urlsplit(image)
    except ValueError:
        return ''
    return image if parts.scheme in ('http', 'https') and parts.hostname and len(image) <= 2048 else ''


def pinterest_endpoint(parts):
    hosts = ('pinterest.com', 'www.pinterest.com', 'kr.pinterest.com',
             'pinterest.co.kr', 'www.pinterest.co.kr',
             'pinterest.co.uk', 'www.pinterest.co.uk', 'pinterest.ca', 'www.pinterest.ca',
             'pinterest.de', 'www.pinterest.de', 'pinterest.fr', 'www.pinterest.fr')
    if parts.scheme not in ('http', 'https') or parts.netloc.lower() not in hosts:
        return None
    match = re.fullmatch(r'/pin/(?:[^/]+--)?([0-9]+)/?', parts.path)
    if not match:
        return None
    pin = f'https://www.pinterest.com/pin/{match[1]}/'
    return 'https://www.pinterest.com/oembed.json?' + urlencode({'url': pin})


def try_oembed(endpoint):
    try:
        return fetch_preview(endpoint, oembed=True)
    except (ValueError, OSError, http.client.HTTPException, LookupError):
        return None


def preview(url):
    parts = urlsplit(url)
    endpoint = pinterest_endpoint(parts)
    if (
        parts.scheme in ('http', 'https')
        and parts.netloc.lower() in ('behance.net', 'www.behance.net')
        and parts.path.startswith('/gallery/')
    ):
        project = 'https://www.behance.net' + parts.path
        endpoint = 'https://www.behance.net/services/oembed?' + urlencode({'url': project, 'format': 'json'})
    if not endpoint:
        return fetch_preview(url)
    result = try_oembed(endpoint)
    if result and result['image']:
        return result
    try:
        html = fetch_preview(url)
    except (ValueError, OSError, http.client.HTTPException, LookupError):
        if not result or not any(result.values()):
            raise
        return result
    return {key: value or (result or {}).get(key, '') for key, value in html.items()}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent / 'dist'), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        parts = urlsplit(self.path)
        if parts.path != '/api/preview':
            return super().do_GET()
        url = parse_qs(parts.query).get('url', [''])[0]
        status = 200
        try:
            if not url or len(url) > 4096:
                raise ValueError('Enter a valid website link.')
            payload = preview(url)
        except PreviewBlocked:
            status = 422
            payload = {'error': 'The source site denied preview access. You can still save the link or add an image.'}
        except (OSError, http.client.HTTPException):
            status = 502
            payload = {'error': 'The preview server could not reach the source site. You can still save the link or add an image.'}
        except (ValueError, LookupError):
            status = 422
            payload = {'error': 'Preview unavailable. You can still save this link.'}
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    with ThreadingHTTPServer(('127.0.0.1', 8000), Handler) as server:
        print('Study Planner is running at http://127.0.0.1:8000', flush=True)
        server.serve_forever()
