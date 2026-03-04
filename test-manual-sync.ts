// Test script for manual sync functionality
// Run this with: npx tsx test-manual-sync.ts

import { syncShopData } from './app/utils/manual-sync.server';

// Mock admin context for testing
const mockAdmin = {
  graphql: async (query: string, variables?: any) => {
    console.log('Mock GraphQL Query:', query);
    console.log('Variables:', variables);
    
    // Return mock response
    return {
      json: async () => ({
        data: {
          abandonedCheckouts: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Checkout/123456789",
                  customer: {
                    email: "test@example.com",
                    firstName: "John",
                    lastName: "Doe"
                  },
                  totalPriceSet: {
                    presentmentMoney: {
                      amount: "99.99",
                      currencyCode: "USD"
                    }
                  },
                  abandonedCheckoutUrl: "https://example.com/checkout/123456789",
                  createdAt: "2024-01-01T00:00:00Z",
                  updatedAt: "2024-01-01T00:00:00Z",
                  cartToken: "abc123"
                }
              }
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: null
            }
          }
        }
      })
    };
  }
};

async function testManualSync() {
  console.log('Testing manual sync functionality...');
  
  try {
    const result = await syncShopData(mockAdmin as any, "test-shop.myshopify.com");
    
    console.log('Sync Result:', {
      success: result.success,
      message: result.message,
      syncedCount: result.syncedCount,
      errors: result.errors
    });
    
    if (result.success) {
      console.log('✅ Manual sync test passed!');
    } else {
      console.log('❌ Manual sync test failed:', result.message);
    }
  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

// Run the test
testManualSync();
