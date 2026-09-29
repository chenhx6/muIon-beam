import asyncio
import os
from pathlib import Path
import sys


async def main():
    if sys.argv[1] == 'crawl4ai':
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

        async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False)) as crawler:
            result = await asyncio.wait_for(
                crawler.arun('https://example.com', config=CrawlerRunConfig(cache_mode=CacheMode.BYPASS)),
                timeout=45,
            )
            assert result.success and result.status_code == 200 and len(result.html or '') > 100
            print('crawl4ai smoke passed')
    elif sys.argv[1] == 'browser-use':
        from browser_use.browser.profile import BrowserProfile
        from browser_use.browser.session import BrowserSession

        chrome = next(Path(os.environ['PLAYWRIGHT_BROWSERS_PATH']).glob('chromium-*/chrome-win64/chrome.exe'))
        profile = BrowserProfile(
            executable_path=chrome,
            headless=True,
            user_data_dir=Path(os.environ['BROWSER_USE_HOME']) / 'profiles' / 'smoke',
            allowed_domains=['example.com'],
        )
        session = BrowserSession(browser_profile=profile)
        try:
            await asyncio.wait_for(session.start(), timeout=30)
            await asyncio.wait_for(session.navigate_to('https://example.com'), timeout=30)
            assert 'example.com' in (await asyncio.wait_for(session.get_current_page_title(), timeout=30)).lower()
            print('browser-use smoke passed')
        finally:
            await session.kill()
    else:
        raise ValueError('expected crawl4ai or browser-use')


asyncio.run(main())
