// Test script for merchant sync functionality
// Run this with: npx tsx test-merchant-sync.ts

import { syncShopData } from './app/utils/manual-sync.server';

// Mock admin context for testing
const mockAdmin = {
  graphql: async (query: string, variables?: any) => {
    console.log('Merchant Sync - Mock GraphQL Query:', query.substring(0, 100) + '...');
    
    // Return mock response with merchant-specific data
    return {
      json: async () => ({
        data: {
          abandonedCheckouts: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Checkout/merchant123",
                  customer: {
                    email: "customer@merchantstore.com",
                    firstName: "Jane",
                    lastName: "Smith"
                  },
                  totalPriceSet: {
                    presentmentMoney: {
                      amount: "149.99",
                      currencyCode: "USD"
                    }
                  },
                  abandonedCheckoutUrl: "https://merchantstore.myshopify.com/checkout/merchant123",
                  createdAt: "2024-01-15T10:30:00Z",
                  updatedAt: "2024-01-15T10:30:00Z",
                  cartToken: "merchant456"
                }
              },
              {
                node: {
                  id: "gid://shopify/Checkout/merchant789",
                  customer: {
                    email: "buyer@merchantstore.com",
                    firstName: "Bob",
                    lastName: "Johnson"
                  },
                  totalPriceSet: {
                    presentmentMoney: {
                      amount: "89.50",
                      currencyCode: "USD"
                    }
                  },
                  abandonedCheckoutUrl: "https://merchantstore.myshopify.com/checkout/merchant789",
                  createdAt: "2024-01-14T15:45:00Z",
                  updatedAt: "2024-01-14T15:45:00Z",
                  cartToken: "merchant789"
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

async function testMerchantSync() {
  console.log('🧪 Testing merchant sync functionality...');
  console.log('🏪 Simulating sync for: test-merchant.myshopify.com');
  
  try {
    const result = await syncShopData(mockAdmin as any, "test-merchant.myshopify.com");
    
    console.log('\n📊 Sync Results:');
    console.log('✅ Success:', result.success);
    console.log('📝 Message:', result.message);
    console.log('📦 Synced Count:', result.syncedCount);
    console.log('📈 Total Checkouts:', result.totalCheckouts);
    
    if (result.errors && result.errors.length > 0) {
      console.log('⚠️ Errors:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    if (result.success) {
      console.log('\n🎉 Merchant sync test PASSED!');
      console.log('✨ All abandoned checkouts would be synced to Supabase');
      console.log('🔄 Existing records would be updated, new records would be added');
    } else {
      console.log('\n❌ Merchant sync test FAILED');
    }
    
    console.log('\n🔍 What this test simulates:');
    console.log('  • Merchant clicks "Sync Store Data" button');
    console.log('  • System fetches ALL abandoned checkouts from Shopify');
    console.log('  • Records are upserted to Supabase (existing updated, new added)');
    console.log('  • Merchant sees detailed sync results and updated counts');
    
  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

// Run the test
testMerchantSync();
