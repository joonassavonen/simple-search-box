#!/usr/bin/env python3
"""
CLI tool to crawl a site and index its content into FindAI.

Usage:
  python crawl.py --sitemap https://helen.fi/sitemap.xml --api-key <your-api-key>
  python crawl.py --domain helen.fi --max-pages 100
  python crawl.py --demo   # set up demo site
"""

import os
import sys
import time

import click
import httpx
from dotenv import load_dotenv
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.table import Table
from rich import print as rprint

load_dotenv()

console = Console()
BASE_URL = os.getenv("FINDAI_API_URL", "http://localhost:8000")


def api(method: str, path: str, **kwargs) -> dict:
    url = f"{BASE_URL}{path}"
    try:
        r = httpx.request(method, url, timeout=60, **kwargs)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        console.print(f"[red]API error {e.response.status_code}: {e.response.text}[/red]")
        sys.exit(1)
    except Exception as e:
        console.print(f"[red]Request failed: {e}[/red]")
        sys.exit(1)


@click.group()
def cli():
    """FindAI - AI-powered site search CLI"""


@cli.command()
@click.option("--sitemap", required=False, help="Sitemap URL")
@click.option("--domain", required=False, help="Site domain (auto-discovers sitemap)")
@click.option("--name", default=None, help="Site name (defaults to domain)")
@click.option("--api-key", envvar="FINDAI_API_KEY", default=None, help="Existing site API key")
@click.option("--max-pages", default=200, show_default=True, help="Maximum pages to crawl")
@click.option("--site-id", default=None, type=int, help="Re-crawl existing site by ID")
def crawl(sitemap, domain, name, api_key, max_pages, site_id):
    """Crawl a website and index its content."""

    if not sitemap and not domain and not site_id:
        console.print("[red]Provide --sitemap, --domain, or --site-id[/red]")
        sys.exit(1)

    if site_id:
        # Re-crawl existing site
        console.print(f"[cyan]Triggering re-crawl for site {site_id}...[/cyan]")
        result = api("POST", "/api/crawl", json={"site_id": site_id, "sitemap_url": sitemap})
    else:
        # Determine domain from sitemap URL if not given
        if not domain and sitemap:
            from urllib.parse import urlparse
            domain = urlparse(sitemap).netloc

        site_name = name or domain
        sitemap_url = sitemap or f"https://{domain}/sitemap.xml"

        # Register site
        console.print(f"[cyan]Registering site: {site_name} ({domain})[/cyan]")
        site_data = api("POST", "/api/sites", json={
            "name": site_name,
            "domain": domain,
            "sitemap_url": sitemap_url,
        })
        site_id = site_data["id"]
        console.print(f"[green]Site registered! ID: {site_id}, API key: {site_data['api_key']}[/green]")
        console.print(f"\n[yellow]Save this API key - it's shown only once:[/yellow]")
        console.print(f"  [bold]{site_data['api_key']}[/bold]\n")

        result = api("POST", "/api/crawl", json={"site_id": site_id, "sitemap_url": sitemap_url})

    job_id = result["job_id"]
    console.print(f"[cyan]Crawl job started (ID: {job_id}). Monitoring progress...[/cyan]\n")

    # Poll job status
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Crawling...", total=None)

        while True:
            time.sleep(3)
            status = api("GET", f"/api/crawl/{job_id}")
            found = status.get("pages_found", 0)
            indexed = status.get("pages_indexed", 0)

            if found > 0:
                progress.update(task, total=found, completed=indexed,
                                description=f"Indexing pages ({indexed}/{found})")

            if status["status"] in ("done", "done_with_errors", "failed"):
                break

    console.print()
    if status["status"] == "failed":
        console.print(f"[red]Crawl failed: {status.get('error')}[/red]")
        sys.exit(1)

    table = Table(title="Crawl Complete", show_header=False, box=None)
    table.add_row("Pages found", str(status["pages_found"]))
    table.add_row("Pages indexed", str(status["pages_indexed"]))
    table.add_row("Status", f"[green]{status['status']}[/green]")
    console.print(table)

    console.print(f"\n[green]Done! Site ID {site_id} is ready to search.[/green]")
    console.print(f"Try: [cyan]python crawl.py search --site-id {site_id} --query 'your query'[/cyan]")


@cli.command()
@click.option("--site-id", required=True, type=int)
@click.option("--query", required=True, help="Search query")
@click.option("--max-results", default=5, show_default=True)
def search(site_id, query, max_results):
    """Test search against an indexed site."""
    console.print(f"\n[cyan]Searching site {site_id} for: '{query}'[/cyan]\n")

    result = api("POST", "/api/search", json={
        "site_id": site_id,
        "query": query,
        "max_results": max_results,
    })

    console.print(f"Language detected: [bold]{result['language']}[/bold]")
    console.print(f"Response time: {result['response_ms']}ms\n")

    if not result["results"]:
        console.print(f"[yellow]No results. Fallback: {result.get('fallback_message')}[/yellow]")
        return

    for i, r in enumerate(result["results"], 1):
        console.print(f"[bold]{i}. {r['title']}[/bold]  [dim](score: {r['score']:.2f})[/dim]")
        console.print(f"   [blue]{r['url']}[/blue]")
        console.print(f"   {r['snippet']}")
        console.print(f"   [dim]Why: {r['reasoning']}[/dim]")
        console.print()


@cli.command()
def demo():
    """Set up demo site with sample Finnish content."""
    console.print("[cyan]Setting up FindAI demo site...[/cyan]")
    result = api("GET", "/api/demo/setup")
    console.print(f"[green]{result['message']}[/green]")
    site = result["site"]
    console.print(f"Site ID: {site['id']}, Pages: {site['page_count']}")
    console.print(f"\nTest with:")
    console.print(f"  python crawl.py search --site-id {site['id']} --query 'sähkökatko mitä teen'")
    console.print(f"  python crawl.py search --site-id {site['id']} --query 'how do I pay my bill'")


if __name__ == "__main__":
    cli()
