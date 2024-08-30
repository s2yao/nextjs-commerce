import { HIDDEN_PRODUCT_TAG, SHOPIFY_GRAPHQL_API_ENDPOINT, TAGS } from 'lib/constants';
import { isShopifyError } from 'lib/type-guards';
import { ensureStartsWith } from 'lib/utils';
import { revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  addToCartMutation,
  createCartMutation,
  editCartItemsMutation,
  removeFromCartMutation
} from './mutations/cart';
import { getCartQuery } from './queries/cart';
import {
  getCollectionProductsQuery,
  getCollectionQuery,
  getCollectionsQuery
} from './queries/collection';
import { getMenuQuery } from './queries/menu';
import { getPageQuery, getPagesQuery } from './queries/page';
import {
  getProductQuery,
  getProductRecommendationsQuery,
  getProductsQuery
} from './queries/product';
import {
  Cart,
  Collection,
  Connection,
  Image,
  Menu,
  Page,
  Product,
  ShopifyAddToCartOperation,
  ShopifyCart,
  ShopifyCartOperation,
  ShopifyCollection,
  ShopifyCollectionOperation,
  ShopifyCollectionProductsOperation,
  ShopifyCollectionsOperation,
  ShopifyCreateCartOperation,
  ShopifyMenuOperation,
  ShopifyPageOperation,
  ShopifyPagesOperation,
  ShopifyProduct,
  ShopifyProductOperation,
  ShopifyProductRecommendationsOperation,
  ShopifyProductsOperation,
  ShopifyRemoveFromCartOperation,
  ShopifyUpdateCartOperation
} from './types';

const domain = process.env.SHOPIFY_STORE_DOMAIN
  ? ensureStartsWith(process.env.SHOPIFY_STORE_DOMAIN, 'https://')
  : '';
const endpoint = `${domain}${SHOPIFY_GRAPHQL_API_ENDPOINT}`;
const key = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN!;

type ExtractVariables<T> = T extends { variables: object } ? T['variables'] : never;

export async function shopifyFetch<T>({
  cache = 'force-cache',
  headers,
  query,
  tags,
  variables
}: {
  cache?: RequestCache;
  headers?: HeadersInit;
  query: string;
  tags?: string[];
  variables?: ExtractVariables<T>;
}): Promise<{ status: number; body: T } | never> {
  try {
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': key,
        ...headers
      },
      body: JSON.stringify({
        ...(query && { query }),
        ...(variables && { variables })
      }),
      cache,
      ...(tags && { next: { tags } })
    });

    const body = await result.json();

    if (body.errors) {
      throw body.errors[0];
    }

    return {
      status: result.status,
      body
    };
  } catch (e) {
    if (isShopifyError(e)) {
      throw {
        cause: e.cause?.toString() || 'unknown',
        status: e.status || 500,
        message: e.message,
        query
      };
    }

    throw {
      error: e,
      query
    };
  }
}

const removeEdgesAndNodes = <T>(array: Connection<T>): T[] => {
  return array.edges.map((edge) => edge?.node);
};

const reshapeCart = (cart: ShopifyCart): Cart => {
  if (!cart.cost?.totalTaxAmount) {
    cart.cost.totalTaxAmount = {
      amount: '0.0',
      currencyCode: 'USD'
    };
  }

  return {
    ...cart,
    lines: removeEdgesAndNodes(cart.lines)
  };
};

const reshapeCollection = (collection: ShopifyCollection): Collection | undefined => {
  if (!collection) {
    return undefined;
  }

  return {
    ...collection,
    path: `/search/${collection.handle}`
  };
};

const reshapeCollections = (collections: ShopifyCollection[]) => {
  const reshapedCollections = [];

  for (const collection of collections) {
    if (collection) {
      const reshapedCollection = reshapeCollection(collection);

      if (reshapedCollection) {
        reshapedCollections.push(reshapedCollection);
      }
    }
  }

  return reshapedCollections;
};

const reshapeImages = (images: Connection<Image>, productTitle: string) => {
  const flattened = removeEdgesAndNodes(images);

  return flattened.map((image) => {
    const filename = image.url.match(/.*\/(.*)\..*/)?.[1];
    return {
      ...image,
      altText: image.altText || `${productTitle} - ${filename}`
    };
  });
};

const reshapeProduct = (product: ShopifyProduct, filterHiddenProducts: boolean = true) => {
  if (!product || (filterHiddenProducts && product.tags.includes(HIDDEN_PRODUCT_TAG))) {
    return undefined;
  }

  const { images, variants, ...rest } = product;

  return {
    ...rest,
    images: reshapeImages(images, product.title),
    variants: removeEdgesAndNodes(variants)
  };
};

const reshapeProducts = (products: ShopifyProduct[]) => {
  const reshapedProducts = [];

  for (const product of products) {
    if (product) {
      const reshapedProduct = reshapeProduct(product);

      if (reshapedProduct) {
        reshapedProducts.push(reshapedProduct);
      }
    }
  }

  return reshapedProducts;
};

export async function createCart(): Promise<Cart> {
  // Static response to simulate the creation of a new cart
  return {
    id: "newCartId123",  // Example new cart ID
    checkoutUrl: "https://example.com/checkout",
    cost: {
        subtotalAmount: { amount: "60.00", currencyCode: "USD" },
        totalAmount: { amount: "70.00", currencyCode: "USD" }, // Assuming tax is calculated
        totalTaxAmount: { amount: "10.00", currencyCode: "USD" }
    },
    lines: [
      {
        id: "line1",
        quantity: 5,
        cost: {
          totalAmount: { amount: "60.00", currencyCode: "USD" }
        },
        merchandise: {
          id: "002",
          title: "Acme Vintage Hoodie",
          selectedOptions: [
              { name: "Size", value: "Large" }
          ],
          product: {
              id: "002",
              handle: "vintage-hoodie",
              title: "Acme Vintage Hoodie",
              featuredImage: {
                  url: "/local_data_store/hoodie-1.avif", // Make sure the path to the image is correct
                  altText: "A vintage hoodie",
                  width: 500,
                  height: 500
              }
          }
        }
      }
    ],  // Starting with one hoodie in the cart
    totalQuantity: 1  // Only one item in the new cart
};
}

export async function addToCart(
  cartId: string,
  lines: { merchandiseId: string; quantity: number }[]
): Promise<Cart> {
    // Directly returning a static Cart object
    return {
        id: cartId,  // Using the passed cartId for continuity
        checkoutUrl: "https://example.com/checkout",
        cost: {
            subtotalAmount: { amount: "120.00", currencyCode: "USD" },
            totalAmount: { amount: "130.00", currencyCode: "USD" },
            totalTaxAmount: { amount: "10.00", currencyCode: "USD" }
        },
        lines: [
            {
                id: "line1",
                quantity: 2,
                cost: {
                    totalAmount: { amount: "60.00", currencyCode: "USD" }
                },
                merchandise: {
                    id: "001",
                    title: "Acme Classic T-Shirt",
                    selectedOptions: [
                        { name: "Size", value: "Medium" }
                    ],
                    product: {
                        id: "001",
                        handle: "classic-t-shirt",
                        title: "Acme Classic T-Shirt",
                        featuredImage: {
                            url: "/local_data_store/t-shirt-1.avif",
                            altText: "A cool t-shirt",
                            width: 500,
                            height: 500
                        }
                    }
                }
            },
            {
                id: "line2",
                quantity: 1,
                cost: {
                    totalAmount: { amount: "60.00", currencyCode: "USD" }
                },
                merchandise: {
                    id: "002",
                    title: "Acme Vintage Hoodie",
                    selectedOptions: [
                        { name: "Size", value: "Large" }
                    ],
                    product: {
                        id: "002",
                        handle: "vintage-hoodie",
                        title: "Acme Vintage Hoodie",
                        featuredImage: {
                            url: "/local_data_store/t-shirt-1.avif",
                            altText: "A vintage hoodie",
                            width: 500,
                            height: 500
                        }
                    }
                }
            }
        ],
        totalQuantity: 3
    };
}


export async function removeFromCart(cartId: string, lineIds: string[]): Promise<Cart> {
  // Static response that simulates the removal of items from the cart
  return {
      id: cartId,  // Use the provided cartId
      checkoutUrl: "https://example.com/checkout",
      cost: {
          subtotalAmount: { amount: "80.00", currencyCode: "USD" },
          totalAmount: { amount: "88.00", currencyCode: "USD" },
          totalTaxAmount: { amount: "8.00", currencyCode: "USD" }
      },
      lines: [
          {
              id: "line1",
              quantity: 1,  // Adjusting quantity after removal of items
              cost: {
                  totalAmount: { amount: "40.00", currencyCode: "USD" }
              },
              merchandise: {
                  id: "001",
                  title: "Acme Classic T-Shirt",
                  selectedOptions: [
                      { name: "Size", value: "Medium" }
                  ],
                  product: {
                      id: "001",
                      handle: "classic-t-shirt",
                      title: "Acme Classic T-Shirt",
                      featuredImage: {
                          url: "/local_data_store/t-shirt-1.avif",
                          altText: "A cool t-shirt",
                          width: 500,
                          height: 500
                      }
                  }
              }
          }
      ],
      totalQuantity: 1  // Adjusted total quantity reflecting the removal
  };
}

export async function updateCart(
  cartId: string,
  lines: { id: string; merchandiseId: string; quantity: number }[]
): Promise<Cart> {
    // Static response to simulate the cart state after updating items
    return {
        id: cartId,  // Use the provided cartId
        checkoutUrl: "https://example.com/checkout",
        cost: {
            subtotalAmount: { amount: "160.00", currencyCode: "USD" },
            totalAmount: { amount: "172.00", currencyCode: "USD" },
            totalTaxAmount: { amount: "12.00", currencyCode: "USD" }
        },
        lines: lines.map(line => ({
            id: line.id,
            quantity: line.quantity,
            cost: {
                totalAmount: { amount: (40 * line.quantity).toFixed(2), currencyCode: "USD" }  // Assuming each item has a base price of 40 USD
            },
            merchandise: {
                id: line.merchandiseId,
                title: "Acme Product",  // Simplified product title, you may want to fetch or define these based on actual merchandiseId
                selectedOptions: [
                    { name: "Size", value: "Default" }  // Placeholder, adjust based on actual data
                ],
                product: {
                    id: line.merchandiseId,
                    handle: "product-handle",  // Placeholder
                    title: "Acme Product",
                    featuredImage: {
                        url: "/local_data_store/t-shirt-1.avif",
                        altText: "Product Image",
                        width: 500,
                        height: 500
                    }
                }
            }
        })),
        totalQuantity: lines.reduce((total, line) => total + line.quantity, 0)  // Summing up all quantities
    };
}

export async function getCart(cartId: string | undefined): Promise<Cart | undefined> {
  if (!cartId) {
      return undefined;
  }

  // Directly returning a static Cart object if the cartId is provided
  return {
      id: cartId,  // Using the provided cartId
      checkoutUrl: "https://example.com/checkout",
      cost: {
          subtotalAmount: { amount: "120.00", currencyCode: "USD" },
          totalAmount: { amount: "130.00", currencyCode: "USD" },
          totalTaxAmount: { amount: "10.00", currencyCode: "USD" }
      },
      lines: [
          {
              id: "line1",
              quantity: 2,
              cost: {
                  totalAmount: { amount: "60.00", currencyCode: "USD" }
              },
              merchandise: {
                  id: "001",
                  title: "Acme Classic T-Shirt",
                  selectedOptions: [
                      { name: "Size", value: "Medium" }
                  ],
                  product: {
                      id: "001",
                      handle: "classic-t-shirt",
                      title: "Acme Classic T-Shirt",
                      featuredImage: {
                          url: "/local_data_store/t-shirt-1.avif",
                          altText: "A cool t-shirt",
                          width: 500,
                          height: 500
                      }
                  }
              }
          }
      ],
      totalQuantity: 2
  };
}

export async function getCollection(handle: string): Promise<Collection | undefined> {
  // Static collections mapped by handle
  const collections: Record<string, Collection> = {
      'All': {
          handle: 'spring-2020',
          title: 'Spring 2020 Collection',
          description: 'Explore our exciting new collection for Spring 2020!',
          seo: {
              title: 'Spring 2020 Collection',
              description: 'Browse our Spring 2020 collection featuring vibrant colors and fresh designs.'
          },
          updatedAt: new Date().toISOString(),
          path: '/collections/spring-2020'
      }
  };

  // Return the collection if found, otherwise undefined
  return collections[handle];
}

// Define a type guard to check if a string is a valid key of Product
function isValidProductKey(key: any): key is keyof Product {
  return ["id", "handle", "title", "availableForSale", "description", "descriptionHtml", "options", "priceRange", "variants", "images", "featuredImage", "seo", "tags", "updatedAt"].includes(key);
}

export async function getCollectionProducts({
  collection,
  reverse,
  sortKey
}: {
  collection: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
    const staticProducts: Product[] = [
      {
        id: "001",
        handle: "classic-t-shirt",
        title: "Acme Classic T-Shirt",
        availableForSale: true,
        description: "A classic cotton t-shirt",
        descriptionHtml: "<p>A classic cotton t-shirt</p>", // HTML version of the description
        options: [
            {
                id: "option1",
                name: "Size",
                values: ["Small", "Medium", "Large"]
            }
        ],
        priceRange: {
            maxVariantPrice: { amount: "19.99", currencyCode: "USD" },
            minVariantPrice: { amount: "19.99", currencyCode: "USD" }
        },
        variants: [{
            id: "00101",
            title: "Small",
            availableForSale: true,
            selectedOptions: [{
                name: "Size",
                value: "Small"
            }],
            price: {
                amount: "19.99",
                currencyCode: "USD"
            }
        }],
        images: [{
            url: "/local_data_store/t-shirt-1.avif",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        }],
        featuredImage: {
            url: "/local_data_store/t-shirt-1.avif",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        },
        seo: {
            title: "Buy Classic T-Shirt",
            description: "Comfortable and stylish classic cotton t-shirts"
        },
        tags: ["fashion", "cotton", "t-shirt"],
        updatedAt: new Date().toISOString()
    },
    {
        id: "001",
        handle: "acme-cup",
        title: "Acme Cup",
        availableForSale: true,
        description: "A cup",
        descriptionHtml: "<p>A cup</p>", // HTML version of the description
        options: [
            {
                id: "option1",
                name: "Size",
                values: ["Small", "Medium", "Large"]
            }
        ],
        priceRange: {
            maxVariantPrice: { amount: "19.99", currencyCode: "USD" },
            minVariantPrice: { amount: "19.99", currencyCode: "USD" }
        },
        variants: [{
            id: "00101",
            title: "Small",
            availableForSale: true,
            selectedOptions: [{
                name: "Size",
                value: "Small"
            }],
            price: {
                amount: "19.99",
                currencyCode: "USD"
            }
        }],
        images: [{
            url: "/local_data_store/image copy.png",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        }],
        featuredImage: {
            url: "/local_data_store/image copy.png",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        },
        seo: {
            title: "Buy Classic T-Shirt",
            description: "Comfortable and stylish classic cotton t-shirts"
        },
        tags: ["fashion", "cotton", "t-shirt"],
        updatedAt: new Date().toISOString()
    },
    {
        id: "001",
        handle: "acme-drawstring-bag",
        title: "Acme Drawstring Bag",
        availableForSale: true,
        description: "A classic cotton t-shirt",
        descriptionHtml: "<p>A classic cotton t-shirt</p>", // HTML version of the description
        options: [
            {
                id: "option1",
                name: "Size",
                values: ["Small", "Medium", "Large"]
            }
        ],
        priceRange: {
            maxVariantPrice: { amount: "19.99", currencyCode: "USD" },
            minVariantPrice: { amount: "19.99", currencyCode: "USD" }
        },
        variants: [{
            id: "00101",
            title: "Small",
            availableForSale: true,
            selectedOptions: [{
                name: "Size",
                value: "Small"
            }],
            price: {
                amount: "19.99",
                currencyCode: "USD"
            }
        }],
        images: [{
            url: "/local_data_store/image.png",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        }],
        featuredImage: {
            url: "/local_data_store/image.png",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        },
        seo: {
            title: "Buy Classic T-Shirt",
            description: "Comfortable and stylish classic cotton t-shirts"
        },
        tags: ["fashion", "cotton", "t-shirt"],
        updatedAt: new Date().toISOString()
    },
    {
        id: "001",
        handle: "acme-drawstring-bag",
        title: "Acme Drawstring Bag",
        availableForSale: true,
        description: "A classic cotton t-shirt",
        descriptionHtml: "<p>A classic cotton t-shirt</p>", // HTML version of the description
        options: [
            {
                id: "option1",
                name: "Size",
                values: ["Small", "Medium", "Large"]
            }
        ],
        priceRange: {
            maxVariantPrice: { amount: "19.99", currencyCode: "USD" },
            minVariantPrice: { amount: "19.99", currencyCode: "USD" }
        },
        variants: [{
            id: "00101",
            title: "Small",
            availableForSale: true,
            selectedOptions: [{
                name: "Size",
                value: "Small"
            }],
            price: {
                amount: "19.99",
                currencyCode: "USD"
            }
        }],
        images: [{
            url: "/local_data_store/image.png",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        }],
        featuredImage: {
            url: "/local_data_store/image.png",
            altText: "A cool t-shirt",
            width: 500,
            height: 500
        },
        seo: {
            title: "Buy Classic T-Shirt",
            description: "Comfortable and stylish classic cotton t-shirts"
        },
        tags: ["fashion", "cotton", "t-shirt"],
        updatedAt: new Date().toISOString()
    }
    ];

    // Optionally use parameters if needed for filtering/sorting
    if (reverse) {
        staticProducts.reverse();
    }

    if (sortKey && isValidProductKey(sortKey)) {
        // Example sorting logic based on sortKey
        staticProducts.sort((a, b) => {
            const keyA = a[sortKey];
            const keyB = b[sortKey];
            return keyA > keyB ? 1 : (keyA < keyB ? -1 : 0);
        });
    }

    return staticProducts;
}

export async function getCollections(): Promise<Collection[]> {
  // Define static collections
  const staticCollections: Collection[] = [
      {
          handle: '',
          title: 'All',
          description: 'All products',
          seo: {
              title: 'All',
              description: 'All products'
          },
          path: '/search',
          updatedAt: new Date().toISOString()
      }
      // Add more collections as needed
  ];

  // Filter out hidden collections for the returned list
  return staticCollections.filter(collection => !collection.handle.startsWith('hidden'));
}


// The Text on the header and footer
export async function getMenu(handle: string): Promise<Menu[]> {
  // Define a mock menu based on handles to simulate different responses
  const menus: Record<string, Menu[]> = {
    'next-js-frontend-footer-menu': [
        // Define the menu items you want for this footer
        { title: 'Home', path: '/' },
        { title: 'About Us', path: '/about' },
        { title: 'Contact', path: '/contact' },
        // { title: 'Terms', path: '/terms' }
    ],
    'next-js-frontend-header-menu': [
        // Define the menu items for the header
        { title: 'All', path: '/search' }
    ]
};

  // Mimic response transformation that would normally be done after fetching
  return menus[handle]?.map(item => ({
      title: item.title,
      path: item.path.replace(domain, '').replace('/collections', '/search').replace('/pages', '')
  })) || [];
}

export async function getPage(handle: string): Promise<Page> {
  // Define static pages mapped by handle
  const staticPages: Record<string, Page> = {
      'about': {
          id: '1',
          title: 'About Us',
          handle: 'about',
          body: 'This is the shop for ecoedu society. <br><br>Welcome to the EcoEdu Society, a non-profit organization dedicated to harnessing artificial intelligence and digital innovation to promote sustainable development and ecological awareness. Our mission is to empower communities and businesses through social media advocacy, educational consulting in AI, and transformative digital services, all aimed at fostering a greener, more sustainable future. Join us in driving positive change for our',
          bodySummary: 'Short summary of the About Us page.',
          seo: {
              title: 'About Us - Our Company',
              description: 'Learn more about our company\'s history and mission.'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      },
      'contact': {
          id: '2',
          title: 'Contact',
          handle: 'contact',
          body: 'This is the body text of the Contact page.',
          bodySummary: 'Short summary of the Contact page.',
          seo: {
              title: 'Contact Us',
              description: 'How to contact us.'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      }
      // More pages can be added here
  };

  // Check if the page exists and ensure it's never undefined when returning
  const page = staticPages[handle];
  if (page) {
      return page;
  } else {
      throw new Error(`Page with handle '${handle}' not found.`);
  }
}

export async function getPages(): Promise<Page[]> {
  // Define a static array of Page objects
  const staticPages: Page[] = [
      {
          id: '1',
          title: 'About Us',
          handle: 'about-us',
          body: 'This is the body text of the About Us page, providing detailed information about our company.',
          bodySummary: 'Learn about our company, our goals, and our team.',
          seo: {
              title: 'About Us - Our Company',
              description: 'Discover more about our company\'s history, culture, and values.'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      },
      {
          id: '2',
          title: 'Contact Us',
          handle: 'contact',
          body: 'This page contains contact information including email addresses, phone numbers, and our office location.',
          bodySummary: 'Reach out to us via email, phone, or visit our office for any inquiries.',
          seo: {
              title: 'Contact Us',
              description: 'Find all the ways you can contact our team.'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      },
      {
          id: '3',
          title: 'Services',
          handle: 'services',
          body: 'Detailed description of the services we offer, including custom solutions and support.',
          bodySummary: 'Overview of our services ranging from product support to custom development.',
          seo: {
              title: 'Our Services',
              description: 'Explore the wide range of services we provide to our clients.'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      }
      // Additional pages can be added as needed
  ];

  return staticPages;
}

export async function getProduct(handle: string): Promise<Product | undefined> {
  // Define static products mapped by handle
  const staticProducts: Record<string, Product> = {
    "classic-t-shirt": {
        "id": "001",
        "handle": "classic-t-shirt",
        "title": "Classic T-Shirt",
        "description": "A perfect t-shirt for everyday wear.",
        "descriptionHtml": "<p>A perfect t-shirt for everyday wear.</p>",
        "availableForSale": true,
        "options": [
            {
                "id": "opt1",
                "name": "Size",
                "values": ["Small", "Medium", "Large"]
            }
        ],
        "priceRange": {
            "maxVariantPrice": {
                "amount": "19.99",
                "currencyCode": "USD"
            },
            "minVariantPrice": {
                "amount": "19.99",
                "currencyCode": "USD"
            }
        },
        "variants": [
            {
                "id": "001-small",
                "title": "Small Size",
                "availableForSale": true,
                "selectedOptions": [
                    {
                        "name": "Size",
                        "value": "Small"
                    }
                ],
                "price": {
                    "amount": "19.99",
                    "currencyCode": "USD"
                }
            }
        ],
        "images": [
            {
                "url": "/local_data_store/t-shirt-1.avif",
                "altText": "Classic T-Shirt",
                "width": 500,
                "height": 500
            }
        ],
        "featuredImage": {
            "url": "/local_data_store/t-shirt-1.avif",
            "altText": "Classic T-Shirt",
            "width": 500,
            "height": 500
        },
        "seo": {
            "title": "Buy Classic T-Shirt",
            "description": "Comfortable and stylish classic cotton t-shirts"
        },
        "tags": ["fashion", "cotton", "t-shirt"],
        "updatedAt": new Date().toISOString()
    },
    "acme-cup": {
        "id": "002",
        "handle": "acme-cup",
        "title": "Acme Cup",
        "description": "A stylish cup for all your drinking needs.",
        "descriptionHtml": "<p>A stylish cup for all your drinking needs.</p>",
        "availableForSale": true,
        "options": [
            {
                "id": "opt1",
                "name": "Size",
                "values": ["Small", "Medium", "Large"]
            }
        ],
        "priceRange": {
            "maxVariantPrice": {
                "amount": "9.99",
                "currencyCode": "USD"
            },
            "minVariantPrice": {
                "amount": "19.99",
                "currencyCode": "USD"
            }
        },
        "variants": [
            {
                "id": "002-small",
                "title": "Small Size",
                "availableForSale": true,
                "selectedOptions": [
                    {
                        "name": "Size",
                        "value": "Small"
                    }
                ],
                "price": {
                    "amount": "19.99",
                    "currencyCode": "USD"
                }
            }
        ],
        "images": [
            {
                "url": "/local_data_store/image copy.png",
                "altText": "Acme Cup",
                "width": 500,
                "height": 500
            }
        ],
        "featuredImage": {
            "url": "/local_data_store/image copy.png",
            "altText": "Acme Cup",
            "width": 500,
            "height": 500
        },
        "seo": {
            "title": "Buy Acme Cup",
            "description": "Discover our stylish and durable Acme cups."
        },
        "tags": ["home", "cup", "acme"],
        "updatedAt": new Date().toISOString()
    },
    "acme-drawstring-bag": {
        "id": "003",
        "handle": "acme-drawstring-bag",
        "title": "Acme Drawstring Bag",
        "description": "Perfect for on-the-go storage of your essentials.",
        "descriptionHtml": "<p>Perfect for on-the-go storage of your essentials.</p>",
        "availableForSale": true,
        "options": [
            {
                "id": "opt1",
                "name": "Size",
                "values": ["Small", "Medium", "Large"]
            }
        ],
        "priceRange": {
            "maxVariantPrice": {
                "amount": "14.99",
                "currencyCode": "USD"
            },
            "minVariantPrice": {
                "amount": "14.99",
                "currencyCode": "USD"
            }
        },
        "variants": [
            {
                "id": "003-small",
                "title": "Small Size",
                "availableForSale": true,
                "selectedOptions": [
                    {
                        "name": "Size",
                        "value": "Small"
                    }
                ],
                "price": {
                    "amount": "14.99",
                    "currencyCode": "USD"
                }
            }
        ],
        "images": [
            {
                "url": "/local_data_store/image.png",
                "altText": "Acme Drawstring Bag",
                "width": 500,
                "height": 500
            }
        ],
        "featuredImage": {
            "url": "/local_data_store/image.png",
            "altText": "Acme Drawstring Bag",
            "width": 500,
            "height": 500
        },
        "seo": {
            "title": "Buy Acme Drawstring Bag",
            "description": "Your perfect travel companion, our drawstring bags."
        },
        "tags": ["fashion", "bag", "drawstring"],
        "updatedAt": new Date().toISOString()
    }
}

  // Return the product if found, otherwise undefined
  return staticProducts[handle];
}

export async function getProductRecommendations(productId: string): Promise<Product[]> {
  // Define static product recommendations based on a hypothetical product ID
  const staticProductRecommendations: Record<string, Product[]> = {
      '001': [
          {
              id: '002',
              handle: 'vintage-hoodie',
              title: 'Vintage Hoodie',
              description: 'A cozy hoodie for chilly evenings.',
              availableForSale: true,
              descriptionHtml: '<p>A cozy hoodie for chilly evenings.</p>',
              options: [{
                  id: 'opt2',
                  name: 'Size',
                  values: ['Small', 'Medium', 'Large']
              }],
              priceRange: {
                  maxVariantPrice: {
                      amount: '39.99',
                      currencyCode: 'USD'
                  },
                  minVariantPrice: {
                      amount: '39.99',
                      currencyCode: 'USD'
                  }
              },
              variants: [{
                  id: '002-large',
                  title: 'Large Size',
                  availableForSale: true,
                  selectedOptions: [{
                      name: 'Size',
                      value: 'Large'
                  }],
                  price: {
                      amount: '39.99',
                      currencyCode: 'USD'
                  }
              }],
              images: [{
                  url: '/local_data_store/t-shirt-1.avif',
                  altText: 'Vintage Hoodie',
                  width: 500,
                  height: 500
              }],
              featuredImage: {
                  url: '/local_data_store/t-shirt-1.avif',
                  altText: 'Feature image of Vintage Hoodie',
                  width: 500,
                  height: 500
              },
              seo: {
                  title: 'Buy Vintage Hoodie',
                  description: 'Stay warm with our vintage hoodies.'
              },
              tags: ['hoodie', 'vintage', 'winter'],
              updatedAt: new Date().toISOString()
          },
          // Additional recommended products can be added here
      ],
      // Different recommendations for other product IDs can be added
  };

  // Return the recommendations for the given product ID, or an empty array if none are found
  return staticProductRecommendations[productId] || [];
}





// Helper function to check if a string is a valid key of Product
function isKeyOfProduct(key: any): key is keyof Product {
  return ["id", "handle", "title", "description", "availableForSale", "descriptionHtml", "options", "priceRange", "variants", "images", "seo", "tags", "updatedAt"].includes(key);
}

export async function getProducts({
  query,
  reverse,
  sortKey
}: {
  query?: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
    // Example static products
    const staticProducts: Product[] = [
      {
          id: '001',
          handle: 'classic-t-shirt',
          title: 'Classic T-Shirt',
          description: 'A perfect t-shirt for everyday wear.',
          availableForSale: true,
          descriptionHtml: '<p>A perfect t-shirt for everyday wear.</p>',
          options: [{
              id: 'opt1',
              name: 'Size',
              values: ['Small', 'Medium', 'Large']
          }],
          priceRange: {
              maxVariantPrice: {
                  amount: '19.99',
                  currencyCode: 'USD'
              },
              minVariantPrice: {
                  amount: '19.99',
                  currencyCode: 'USD'
              }
          },
          variants: [{
              id: '001-small',
              title: 'Small Size',
              availableForSale: true,
              selectedOptions: [{
                  name: 'Size',
                  value: 'Small'
              }],
              price: {
                  amount: '19.99',
                  currencyCode: 'USD'
              }
          }],
          images: [{
              url: '/local_data_store/t-shirt-1.avif',
              altText: 'Classic T-Shirt',
              width: 500,
              height: 500
          }],
          featuredImage: {
              url: '/local_data_store/t-shirt-1.avif',
              altText: 'Feature image of Classic T-Shirt',
              width: 500,
              height: 500
          },
          seo: {
              title: 'Buy Classic T-Shirt',
              description: 'Comfortable and stylish classic cotton t-shirts'
          },
          tags: ['fashion', 'cotton', 't-shirt'],
          updatedAt: new Date().toISOString()
      },
      // Additional static products can be added here
  ];

    // Filter products based on the query if provided
    let filteredProducts = query ? staticProducts.filter(product => product.title.toLowerCase().includes(query.toLowerCase()) || product.description.toLowerCase().includes(query.toLowerCase())) : staticProducts;

    // Sort products if sortKey is provided and valid
    if (sortKey && isKeyOfProduct(sortKey)) {
        filteredProducts = filteredProducts.sort((a, b) => {
            const valueA = a[sortKey];
            const valueB = b[sortKey];
            if (valueA < valueB) {
                return reverse ? 1 : -1;
            } else if (valueA > valueB) {
                return reverse ? -1 : 1;
            }
            return 0;
        });
    }

    return filteredProducts;
}


// This is called from `app/api/revalidate.ts` so providers can control revalidation logic.
export async function revalidate(req: NextRequest): Promise<NextResponse> {
  // We always need to respond with a 200 status code to Shopify,
  // otherwise it will continue to retry the request.
  const collectionWebhooks = ['collections/create', 'collections/delete', 'collections/update'];
  const productWebhooks = ['products/create', 'products/delete', 'products/update'];
  const topic = headers().get('x-shopify-topic') || 'unknown';
  const secret = req.nextUrl.searchParams.get('secret');
  const isCollectionUpdate = collectionWebhooks.includes(topic);
  const isProductUpdate = productWebhooks.includes(topic);

  if (!secret || secret !== process.env.SHOPIFY_REVALIDATION_SECRET) {
    console.error('Invalid revalidation secret.');
    return NextResponse.json({ status: 200 });
  }

  if (!isCollectionUpdate && !isProductUpdate) {
    // We don't need to revalidate anything for any other topics.
    return NextResponse.json({ status: 200 });
  }

  if (isCollectionUpdate) {
    revalidateTag(TAGS.collections);
  }

  if (isProductUpdate) {
    revalidateTag(TAGS.products);
  }

  return NextResponse.json({ status: 200, revalidated: true, now: Date.now() });
}
