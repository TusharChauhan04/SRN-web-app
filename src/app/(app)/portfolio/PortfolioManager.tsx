"use client";

import { useActionState, useState } from "react";
import type { PortfolioItem } from "@/lib/repositories/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Spinner,
  Textarea,
  safeHref,
} from "@/components/ui";
import { ImageUploadField } from "@/components/upload/ImageUploadField";
import type { PortfolioState } from "./page";

export function PortfolioManager({
  items,
  addAction,
  deleteAction,
  featureAction,
}: {
  items: PortfolioItem[];
  addAction: (
    prev: PortfolioState,
    formData: FormData,
  ) => Promise<PortfolioState>;
  deleteAction: (formData: FormData) => Promise<void>;
  featureAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState<PortfolioState, FormData>(
    addAction,
    {},
  );
  const [imageUrl, setImageUrl] = useState("");

  return (
    <div className="space-y-6">
      <form action={formAction}>
        <Card>
          <CardHeader
            title="Add a piece of work"
            description="A title and a sentence about the outcome goes further than a screenshot alone."
          />
          <div className="space-y-5 p-5">
            <Field label="Title" htmlFor="title">
              <Input
                id="title"
                name="title"
                required
                minLength={2}
                maxLength={120}
                placeholder="Logistics tracking dashboard"
              />
            </Field>

            <Field label="Description" htmlFor="description">
              <Textarea
                id="description"
                name="description"
                maxLength={1000}
                rows={3}
                placeholder="Real-time shipment tracking for a 200-vehicle fleet."
              />
            </Field>

            <Field
              label="Project link"
              htmlFor="projectUrl"
              hint="Optional. A live URL, repo, or case study."
            >
              <Input
                id="projectUrl"
                name="projectUrl"
                type="url"
                maxLength={500}
                placeholder="https://example.com/case-study"
              />
            </Field>

            <ImageUploadField
              context="portfolio"
              label="Cover image"
              hint="Optional. JPEG, PNG or WebP, up to 10MB."
              value={imageUrl}
              onChange={setImageUrl}
            />
            <input type="hidden" name="imageUrl" value={imageUrl} />

            {state.error ? <Alert>{state.error}</Alert> : null}

            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="h-4 w-4" /> : null}
              Add to portfolio
            </Button>
          </div>
        </Card>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing in your portfolio yet"
          description="Customers browsing your profile see this first. Two or three strong pieces beat ten weak ones."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{item.title}</h3>
                  {item.isFeatured ? <Badge tone="info">Featured</Badge> : null}
                </div>

                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="mt-3 aspect-video w-full rounded-xl object-cover"
                  />
                ) : null}

                {item.description ? (
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                    {item.description}
                  </p>
                ) : null}

                {safeHref(item.projectUrl) ? (
                  <a
                    href={safeHref(item.projectUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-sm text-[var(--primary)] hover:underline"
                  >
                    View project
                  </a>
                ) : null}

                <div className="mt-auto flex gap-2 pt-4">
                  <form action={featureAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input
                      type="hidden"
                      name="featured"
                      value={String(!item.isFeatured)}
                    />
                    <Button size="sm" variant="outline" type="submit">
                      {item.isFeatured ? "Unfeature" : "Feature"}
                    </Button>
                  </form>

                  <form action={deleteAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button size="sm" variant="ghost" type="submit">
                      Delete
                    </Button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
